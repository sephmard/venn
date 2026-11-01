# Claude, ChatGPT and MCP

Venn is an [MCP](https://modelcontextprotocol.io) server, so people can make a Venn and read its answers from an AI assistant: "Find an evening for book club in the next two weeks" in Claude or ChatGPT turns into a poll link to share. The assistant does the language work on its person's own plan. Venn only makes and reads polls through its [API](API.md), so it costs the server nothing in AI and needs no key or sign-in.

The server's address is `https://venn.day/api/mcp` (or `/api/mcp` on your own server). It speaks Streamable HTTP and answers each request with plain JSON; there are no sessions.

## Tools

| Tool               | What it does                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_venn`      | Makes a poll from a `title`, the organizer's `timezone`, and either whole `days` (`YYYY-MM-DD`) or specific `times` (`{ start, end }` in ISO 8601). Returns the share link and the private organizer link. |
| `get_venn_results` | Takes a poll link or id. Returns how many people answered, the best days or times with how many are available or available if needed (and who, unless the organizer hid names), and the picked date.       |

Polls made this way are ordinary polls: the same limits, the same links, and the organizer link manages them in the app.

## Connecting it

- **Claude:** in Settings, under Connectors, add a custom connector with the address above.
- **ChatGPT:** in Settings, under Apps and Connectors, turn on developer mode and create a connector with the address above.
- **Other MCP clients:** add a remote (HTTP) server with the address above. With no remote support, a bridge such as `npx mcp-remote https://venn.day/api/mcp` works.

The menus move from time to time; each assistant's help pages have the current steps.

## Privacy

Through MCP, Venn sees only what the tools send: the poll's title, days or times, and the optional organizer name, details and place. It never sees the conversation. The assistant sees what the tools return, including names in the answers unless the organizer hid them.
