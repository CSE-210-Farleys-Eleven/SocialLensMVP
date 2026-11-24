# Normalize for post analytics

`normalize(input: AdapterResult): NormalizeResult` turns one [adapter result](../adapters/README.md)
into a plain JSON snapshot for analytics. It runs synchronously in memory.
The implementation is in [src/normalize/](../../src/normalize/), with public types in
[`contract.ts`](../../src/normalize/contract.ts).

| Output field | Meaning |
| --- | --- |
| `fetchedAt` | Start of the adapter collection, copied from the input. |
| `posts` | One row per `app.bsky.feed.post` record, including replies. Records and engagement can arrive in any order. |
| `coverage` | All adapter coverage entries, including their source, collection, count, completeness and reason when present. |

| Post field | Meaning |
| --- | --- |
| `uri` | Full AT URI of the post. It identifies the record and joins it to its engagement item. |
| `createdAt` | Publication timestamp from the post body. A missing or unreadable timestamp yields `null`; the post still counts toward activity. |
| `isReply` | `true` for a reply object, `false` for a readable body without a reply field, and `null` for an unreadable body or malformed reply field. |
| `engagement` | The matching item's `likeCount`, `replyCount`, `repostCount` and `quoteCount`. A missing match yields `null`. Each reported zero is preserved, as is a `null` quote count. |

Averages use the posts with a known value for the metric. For example, if one post has
zero replies and another has unknown engagement, the average is zero across **one** measured
post. Both posts still appear in the activity timeline if their publication times are known.
Engagement counts describe the collection snapshot. They do not date the individual interactions.

Use the post and engagement coverage entries separately when reporting totals. An empty
post list represents a confirmed zero only when the relevant coverage establishes it.
An engagement item without a matching post record does not create a post.
