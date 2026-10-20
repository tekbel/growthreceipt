# Homepage architecture flow

Status: proposed for implementation after the current judged flow is stable.

## Purpose

Add an optional animated explanation to the homepage that lets judges understand the complete GrowthReceipt lifecycle without entering the workspace first.

The experience should make one idea unmistakable:

> An approved post earns a verified PayPal purchase. GrowthReceipt proves which post earned it, then proposes the next experiment for the founder to approve.

This is an explanation of the real product architecture, not a decorative animation. Every stage must match the submitted build.

## Homepage placement

Keep the existing hero concise. Add one quiet control beneath its primary actions:

**See the full revenue loop**

Selecting it opens a large, focused panel. The flow must not play automatically on the homepage or compete with the main call to action.

Panel title:

**From approved post to verified revenue**

Supporting text:

**See how GrowthReceipt turns a PayPal purchase into the next experiment you approve.**

## Complete lifecycle

The animation follows one post through the entire system.

1. **Brief**
   The founder describes the product, audience, objective, channels and brand voice, or pastes a link to the product page and the brief agent suggests the brief for the founder to edit.

2. **Campaign agent**
   One agent run sets the campaign positioning, then drafts one post per day across the chosen channels. Every draft waits in review. The animation may show the positioning first and the posts second, but it is one agent, not two.

3. **Human approval**
   The founder approves or edits each post, or requests changes with a note. The revision agent rewrites a post to match the note and it returns to review. Nothing gets a buy link or publishes without approval.

4. **Approved post and buy link**
   Each approved post receives its own public buy link, preserving the connection between the message and a later purchase. LinkedIn posts publish with one click. Posts for other channels are copied and posted by the founder.

5. **Customer checkout**
   A customer opens the link and completes payment through the PayPal Sandbox. The price comes from the server catalog.

6. **PayPal verification**
   GrowthReceipt creates and captures the order on the server. PayPal sends the webhook, and GrowthReceipt verifies its signature before treating the payment as evidence.

7. **Revenue attribution**
   The order, capture, webhook, campaign, offer, and referring post form one traceable receipt chain.

8. **Next move agent**
   Code ranks the paying posts and labels the evidence as an early signal, a clear leader or a tie. The agent reads that evidence, looks up the orders it cites with the PayPal Orders API, and proposes one focused experiment with its reason and confidence. The PayPal lookup returns only order status, capture status and amount.

9. **Human approval**
   The founder approves, edits, or rejects the recommendation. An offer switch is optional, comes only from the existing catalog, and needs at least one purchase behind it.

10. **Next post**
    Once approved, the agent drafts the follow up post. It returns to review, receives its own buy link after approval, and begins the next measurement cycle.

## Visual direction

Use one continuous path rather than a collection of disconnected cards.

The active signal travels through the system while inactive stages remain quiet. Movement should feel measured and deliberate. The PayPal capture is the visual turning point where marketing activity becomes verified evidence.

Represent the participants clearly:

| Participant | Treatment |
| --- | --- |
| Founder | Warm neutral surface with a clear approval control |
| GrowthReceipt agents | Restrained brand color with role names, never generic robot or sparkle icons |
| Published post | The real platform icon and a compact post preview. Only LinkedIn shows as published by GrowthReceipt |
| PayPal | Official PayPal mark, only after the PayPal brand guidelines check confirms the use |
| Verified evidence | Receipt language, capture ID, check mark, and recorded timestamp |
| Next experiment | A focused proposal that visibly waits for human approval |

Avoid bright gradients, glowing effects, decorative particles, excessive borders, and invented provider icons. Match the typography, color, spacing, and motion already used by GrowthReceipt.

## Motion sequence

The complete sequence should take about 20 seconds.

1. The product brief settles into place.
2. The campaign agent sets the positioning, then draft posts arrive in the review queue.
3. Motion pauses at the first human approval.
4. The approved post moves into the publishing and checkout path.
5. The official PayPal mark appears as the customer completes payment.
6. The payment resolves into an order, capture, and verified webhook.
7. The receipt travels back to the referring post and marks it as attributed revenue.
8. The next move agent reads the verified evidence, checks the cited orders with PayPal, and prepares one experiment.
9. Motion pauses at the second human approval.
10. The approved experiment becomes a new draft and reconnects to the review queue.

The final frame should preserve the complete loop long enough to understand it.

## Controls

Provide:

* Play and pause
* Restart
* Previous and next step
* A progress label such as `5 of 10`
* Close

Selecting any stage pauses the sequence and opens a short explanation. Keyboard users must be able to reach every stage and control.

## Responsive behavior

Desktop uses the full horizontal loop.

Tablet uses a compact two row path.

Mobile uses a vertical guided sequence with the same stages and copy. Do not shrink the desktop diagram until labels become unreadable.

## Accessibility

* Respect `prefers-reduced-motion`.
* In reduced motion mode, show the complete static sequence with manual step controls.
* Provide a concise text version beneath the visual or through an accessible description.
* Preserve a logical reading order independent of the animated position.
* Never use color alone to distinguish people, agents, approvals, or verified evidence.
* Keep controls labelled and maintain visible keyboard focus.

## Performance

* Load the animation only after the panel is opened.
* Prefer React, SVG, CSS transforms, and opacity.
* Avoid a new animation dependency unless the existing stack cannot provide the required control.
* Pause when the panel is closed or outside the viewport.
* Do not delay homepage interaction, affect Core Web Vitals, or load PayPal scripts for this explanation.
* Use only local, optimized assets and official provider marks already approved for the project.

## Suggested component structure

Keep the implementation data driven and small:

* `HomepageRevenueLoopTrigger`
* `RevenueLoopPanel`
* `RevenueLoopStage`
* `RevenueLoopPath`
* `RevenueLoopControls`
* One ordered stage definition containing the label, actor, explanation, icon, and timing

The visual should read from the stage data. Do not duplicate the lifecycle in separate desktop and mobile implementations.

## Judge value

The flow should support the judging criteria without naming them on screen:

| Criterion | What the flow demonstrates |
| --- | --- |
| Technological implementation | Server controlled PayPal checkout, capture, webhook verification, attribution, and evidence checked recommendations |
| Design | A complex system explained clearly without adding friction to the homepage |
| Potential impact | Founders can act on purchases rather than likes and clicks |
| Innovation | Verified payment evidence changes the next marketing decision |
| Presentation | The complete product story is understandable in about 20 seconds |

## Acceptance criteria

The feature is ready when:

1. The homepage remains fast and uncluttered before the panel opens.
2. A first time visitor can explain the loop after watching it once.
3. Both human approval points are unmistakable.
4. PayPal is shown as the source of verified payment evidence, not merely a checkout button.
5. The next move agent is shown using verified evidence and remaining within clear limits.
6. The loop ends with a new draft returning to human review.
7. Desktop, tablet, mobile, keyboard, and reduced motion experiences all work.
8. Every label and claim matches the live judged build.
9. No unofficial provider icon, decorative sparkle, or generic robot symbol appears.
10. The animation creates no meaningful homepage performance regression.

## Implementation timing

Build this only after the core judge path is complete, and finish it before the feature freeze on 2026-11-06, since only fixes land after the freeze and the video is recorded from 2026-11-07. Stage names and claims were checked against the build on 2026-10-21. Verify it against the final architecture and run the complete browser rehearsal before recording the submission video.
