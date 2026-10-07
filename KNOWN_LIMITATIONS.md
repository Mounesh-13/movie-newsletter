# Known Limitations (accepted, deliberate)

## DELIVERABILITY STATUS: shared sandbox domain

Currently sending via Resend's shared sandbox domain (`onboarding@resend.dev`).
This WILL land in spam for most recipients — this is expected and accepted for now.

**Current phase: closed pre-launch validation only.** Recipients are hand-picked
and explicitly informed to check spam and mark "Not spam" on first receipt.

**DO NOT open public signups (Vercel landing page) or post the signup link
publicly (Reddit, social, etc.) until this is resolved via either:**

- (a) purchasing and verifying a real domain in Resend, or
- (b) migrating to Gmail SMTP + Supabase (previously scoped, not yet built)

**This limitation does not affect:** picking logic, fact generation, approval
gate, or unsubscribe mechanism correctness — only inbox placement.
