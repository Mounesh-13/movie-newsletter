# Known Limitations (accepted, deliberate)

## DELIVERABILITY STATUS: shared sandbox domain

Currently sending via Resend's shared sandbox domain (`onboarding@resend.dev`).
This only delivers to the Resend account owner. Other recipients are blocked
by Resend; this is NOT merely a spam-folder or inbox-placement issue.
Audience sends now reject this sender before contacting Resend.

**Current phase: closed pre-launch validation only.** Recipients are hand-picked
and must belong to the newsletter segment. Even closed testing with friends
requires a verified sending domain.

**DO NOT open public signups (Vercel landing page) or post the signup link
publicly (Reddit, social, etc.) until this is resolved via either:**

- (a) purchasing and verifying a real domain in Resend, or
- (b) migrating to Gmail SMTP + Supabase (previously scoped, not yet built)

**This limitation blocks delivery to friends.** Picking, fact generation, and
draft approval remain usable. See README for domain setup and repairing
existing global-only contacts. Real broadcast unsubscribe behavior still
requires an inbox check.
