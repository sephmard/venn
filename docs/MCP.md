# Claude, ChatGPT and MCP

Venn is an [MCP](https://modelcontextprotocol.io) server, so people can make a Venn and read its answers from an AI assistant: "Find an evening for book club in the next two weeks" in Claude or ChatGPT turns into a poll link to share. The assistant does the language work on its person's own plan. Venn only makes and reads polls through its [API](API.md), so it costs the server nothing in AI and needs no key or sign-in.

The server's address is `https://venn.day/api/mcp` (or `/api/mcp` on your own server). It speaks Streamable HTTP and answers each request with plain JSON; there are no sessions.

## Tools

| Tool               | What it does                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_venn`      | Makes a poll from a `title`, the organizer's `timezone`, and exactly one of: whole `days` (`YYYY-MM-DD`) or specific `times` (`{ start, end }` in ISO 8601) to find a date, or `options` (1 to 20 labels, up to 120 characters each, no two the same) to vote on what or where, with `single: true` for pick one. Returns the share link and the private organizer link.                                           |
| `get_venn_results` | Takes a poll link or id. For a date poll: how many people answered, the best days or times with how many are available or available if needed (and who, unless the organizer hid names), and the picked date. For a vote: each option's yes and if-needed counts (and who), the `leading` option or options, a one-line `summary` that says when nobody has answered or options are tied, and the `picked` option. |

A date poll suits "which weekend works?" or "an evening next week"; a vote suits "Italian, Thai or Mexican?" or "which book next?". A vote is the same as a [topic poll](API.md#topic-polls) made at `/new/topic`, and its organizer can find a date for the winner from the poll page.

Results come from the same view of the poll anyone with the link gets: when the organizer hides names, they are left out; when the organizer hides the answers, only the count (and anything picked) comes back.

### Example

A vote, made by calling the tool directly (an assistant sends the same request):

```sh
curl -X POST https://venn.day/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_venn","arguments":{"title":"Dinner on Friday","timezone":"Europe/London","options":["Italian","Thai","Mexican"]}}}'
```

Once people have answered, `get_venn_results` with the link returns, for example:

```json
{
  "title": "Dinner on Friday",
  "link": "https://venn.day/e/abc123",
  "kind": "vote",
  "answers": 3,
  "summary": "Tied: Italian and Thai, 2 of 3 would go to each. No single favourite yet.",
  "leading": ["Italian", "Thai"],
  "options": [
    { "option": "Italian", "yes": 2, "ifNeeded": 0, "who": { "yes": ["Ana", "Bo"], "ifNeeded": [] } },
    { "option": "Thai", "yes": 2, "ifNeeded": 0, "who": { "yes": ["Bo", "Cy"], "ifNeeded": [] } },
    { "option": "Mexican", "yes": 0, "ifNeeded": 1, "who": { "yes": [], "ifNeeded": ["Ana"] } }
  ]
}
```

Polls made this way are ordinary polls: the same limits, the same links, and the organizer link manages them in the app.

## Connecting it

- **Claude:** in Settings, under Connectors, add a custom connector with the address above.
- **ChatGPT:** in Settings, under Apps and Connectors, turn on developer mode and create a connector with the address above.
- **Other MCP clients:** add a remote (HTTP) server with the address above. With no remote support, a bridge such as `npx mcp-remote https://venn.day/api/mcp` works.

The menus move from time to time; each assistant's help pages have the current steps.

## Privacy

Through MCP, Venn sees only what the tools send: the poll's title, days, times or options, and the optional organizer name, details and place. It never sees the conversation. The assistant sees what the tools return, including names in the answers unless the organizer hid them.
