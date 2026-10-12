"""The offers a campaign's buy links can sell.

These are the real LaunchCheck scan packs. A campaign sells one of them at a
time. The agent may suggest switching to another offer from this catalog, but
only the founder's approval changes it, and nothing outside the catalog can
ever be sold.
"""

from decimal import Decimal

from app.paypal.gateway import Offer

DEFAULT_OFFER_ID = "launchcheck-scan-pack"

OFFERS = {
    offer.id: offer
    for offer in (
        Offer(
            id="launchcheck-scan-pack-3",
            name="LaunchCheck 3 scan pack",
            description="3 extra page scans, paid once",
            amount=Decimal("4.00"),
            currency="USD",
            credits=3,
        ),
        Offer(
            id=DEFAULT_OFFER_ID,
            name="LaunchCheck 10 scan pack",
            description="10 extra page scans, paid once",
            amount=Decimal("9.00"),
            currency="USD",
            credits=10,
        ),
        Offer(
            id="launchcheck-scan-pack-30",
            name="LaunchCheck 30 scan pack",
            description="30 extra page scans, paid once",
            amount=Decimal("19.00"),
            currency="USD",
            credits=30,
        ),
    )
}


def offer_for(offer_id: str) -> Offer:
    """The catalog offer, or the default one for an id the catalog no longer has."""
    return OFFERS.get(offer_id, OFFERS[DEFAULT_OFFER_ID])
