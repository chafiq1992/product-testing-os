# Project instructions

## Ad creative auto-routing
When the user's message is a landing-page / product URL (a bare URL, or a URL with
little or no other instruction), immediately delegate to the **ad-creative**
subagent (`.claude/agents/ad-creative.md`) by launching it with that URL.

Do not ask clarifying questions first. The ad-creative agent will fetch the page
and return: 8 Darija headlines, 2 Darija ad copies, 3 English image-generation
prompts, and a "Landing Page Fixes" section.

Only handle a URL differently if the user explicitly asks for something else
(e.g. "review the code at this URL", "summarize this article").
