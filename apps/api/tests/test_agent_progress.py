from types import SimpleNamespace

import pytest

from app.agents.gateway import AgentProgress, _ProgressTracker


@pytest.mark.asyncio
async def test_tracker_counts_items_across_split_deltas_and_ignores_quoted_keys() -> None:
    reported: list[AgentProgress] = []

    async def report(progress: AgentProgress) -> None:
        reported.append(progress)

    tracker = _ProgressTracker(report)
    chunks = [
        '{"posts":[{"da',
        'y": 1, "content": "Say \\"day\\": once"},',
        '{"day":2',
    ]
    await tracker.accept(SimpleNamespace(type="agent.session.turn.in_progress"))
    for chunk in chunks:
        await tracker.accept(
            SimpleNamespace(type="agent.session.turn.output_text.delta", delta=chunk)
        )

    assert reported == [
        AgentProgress("thinking"),
        AgentProgress("writing", items=1),
        AgentProgress("writing", items=2),
    ]
