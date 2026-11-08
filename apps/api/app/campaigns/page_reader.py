"""Reads a public product page so the agent can suggest a campaign brief from it.

The founder supplies the URL, so every request is checked before it leaves the server:
https only, default port, and every address the host resolves to must be public. Redirects
are followed by hand so each hop gets the same check. Known gap: a host could answer DNS
differently between the check and the connection (DNS rebinding). Pinning the address would
close it but breaks TLS name checks, so the timeout and size cap limit what that can reach.
"""

import asyncio
import ipaddress
import re
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

MAX_BYTES = 1_000_000
MAX_REDIRECTS = 3
MAX_TEXT = 6_000
TIMEOUT = httpx.Timeout(8.0)

Resolver = Callable[[str], Awaitable[list[str]]]


class PageReadError(ValueError):
    """A message safe to show the founder."""


@dataclass
class ProductPage:
    url: str
    title: str = ""
    description: str = ""
    image_url: str | None = None
    text: str = ""


async def resolve_host(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


async def check_url(url: str, resolve: Resolver = resolve_host) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not parts.hostname:
        raise PageReadError("Use a full https link to a public page.")
    if parts.username or parts.password or parts.port not in (None, 443):
        raise PageReadError("Use a plain https link without a port or login.")
    try:
        addresses = await resolve(parts.hostname)
    except OSError:
        raise PageReadError("That site could not be found.") from None
    if not addresses or not all(_is_public(address) for address in addresses):
        raise PageReadError("That link does not point to a public site.")
    return parts.geturl()


def _is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address.split("%")[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


async def read_product_page(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    resolve: Resolver = resolve_host,
) -> ProductPage:
    owned = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)
    try:
        current = await check_url(url, resolve)
        for _ in range(MAX_REDIRECTS + 1):
            body, location, content_type = await _fetch(client, current)
            if location is None:
                if "html" not in content_type:
                    raise PageReadError("That link is not a web page.")
                return _parse(current, body)
            current = await check_url(urljoin(current, location), resolve)
        raise PageReadError("That link redirects too many times.")
    except httpx.HTTPError:
        raise PageReadError("That page could not be read right now.") from None
    finally:
        if owned:
            await client.aclose()


async def _fetch(client: httpx.AsyncClient, url: str) -> tuple[bytes, str | None, str]:
    headers = {"User-Agent": "GrowthReceipt brief reader", "Accept": "text/html"}
    async with client.stream("GET", url, headers=headers) as response:
        if response.is_redirect:
            return b"", response.headers.get("location", ""), ""
        if response.status_code != 200:
            raise PageReadError("That page could not be read. Check the link.")
        body = bytearray()
        async for chunk in response.aiter_bytes():
            body.extend(chunk)
            if len(body) > MAX_BYTES:
                break
        return bytes(body[:MAX_BYTES]), None, response.headers.get("content-type", "")


def _parse(url: str, body: bytes) -> ProductPage:
    parser = _PageParser()
    parser.feed(body.decode("utf-8", errors="replace"))
    meta = parser.meta
    # The app icon, never og:image, which is a wide share card and not an icon.
    image = max(parser.icons, default=None)
    image_url = urljoin(url, image[2]) if image else None
    return ProductPage(
        url=url,
        title=(meta.get("og:title") or parser.title).strip()[:200],
        description=(meta.get("og:description") or meta.get("description") or "").strip()[:1000],
        image_url=image_url if image_url and _usable_image(image_url) else None,
        text=" ".join(" ".join(parser.text).split())[:MAX_TEXT],
    )


def _usable_image(url: str) -> bool:
    # The brief accepts https icon links up to 500 characters.
    return url.startswith("https://") and len(url) <= 500


class _PageParser(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.meta: dict[str, str] = {}
        self.text: list[str] = []
        self.skip = 0
        self.in_title = False
        # (rank, size, href). An apple-touch-icon beats a raster icon, which beats an SVG icon,
        # then bigger wins. SVG is safe here because the app only shows icons in an <img>.
        self.icons: list[tuple[int, int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key and values.get("content") and key not in self.meta:
                self.meta[key] = values["content"]
        elif tag == "link" and values.get("href"):
            rel = values.get("rel", "").lower().split()
            href = values["href"]
            raster = href.lower().split("?")[0].endswith((".png", ".jpg", ".jpeg", ".webp"))
            sizes = re.findall(r"(\d+)x\d+", values.get("sizes", ""))
            size = max((int(size) for size in sizes), default=0)
            if "apple-touch-icon" in rel:
                self.icons.append((2, size or 180, href))
            elif "icon" in rel and raster:
                self.icons.append((1, size, href))
            elif "icon" in rel and href.lower().split("?")[0].endswith(".svg"):
                self.icons.append((0, 0, href))
        elif tag == "title":
            self.in_title = True
        if tag in self.SKIP:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title += data
        elif not self.skip:
            self.text.append(data)
