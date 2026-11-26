# Post analytics contract

`analyze(input: AnalyticsInput): AnalyticsResult` computes a plain JSON summary of a normalized Bluesky post snapshot. It runs synchronously in memory without network requests or persistent storage. The [TypeScript contract](../../src/analytics/contract.ts) defines the input and result types.

## Input

Pass a `NormalizeResult` directly to `analyze`. The [normalizer in PR #19](https://github.com/CSE-210-Farleys-Eleven/SocialLensMVP/pull/19) supplies the fields below. Analytics uses this subset of that contract.

| Field | Meaning |
| --- | --- |
| `fetchedAt` | Collection snapshot timestamp as a string. |
| `posts[].createdAt` | Publication timestamp with an explicit time zone, or `null`. |
| `posts[].isReply` | `true` for a reply, `false` for an original post, or `null` if classification is unknown. |
| `posts[].engagement` | `null` when engagement is unavailable. Otherwise contains numeric `likeCount`, `replyCount` and `repostCount`, and a numeric or `null` `quoteCount`. A reported zero is a measured value. |
| `coverage` | Entries from the [adapter contract](../adapters/README.md). |

Analytics takes the normalized rows as given. The normalizer handles post identity and engagement matching.

## Output

`fetchedAt` is copied from the input. The result contains the following sections.

| Field | Meaning |
| --- | --- |
| `activity.status` | Completeness of the post count. |
| `activity.postCount` | Observed post count including replies, or `null` when coverage cannot establish a count and there are no observed posts. |
| `activity.originals`, `activity.replies`, `activity.unknownReplyStatus` | Counts of observed posts with each reply classification. |
| `activity.undatedPosts` | Observed posts without a usable publication time, including invalid calendar dates. They still contribute to the post count, reply classification and any measured engagement. |
| `activity.byUtcDay` | Publication counts in ascending UTC date order, each with `date` (`YYYY-MM-DD`) and `postCount`. Only days with at least one dated post appear. |
| `engagement.likeCount`, `engagement.replyCount`, `engagement.repostCount`, `engagement.quoteCount` | Each metric returns `status`, `total`, `average` and `measuredPosts`. Totals and averages are computed independently for each metric across posts with a known value, including replies. |
| `coverage.posts`, `coverage.engagement` | Copies of the corresponding `app.bsky.feed.post` and `engagement` coverage entries, including source, completeness and any reason. Consumers can identify synthetic coverage by `source: 'fixtures'`. |

### Status and missing values

| Status | Activity | Engagement metric |
| --- | --- | --- |
| `complete` | At least one post coverage entry exists. Every post entry is complete and its fetched count equals the observed post count. | Activity is complete, at least one engagement coverage entry exists, every engagement entry is complete with a fetched count matching the observed post count, and all observed posts have a value for the metric. |
| `partial` | At least one post was observed, with insufficient evidence of complete post coverage. | At least one post has a measured value, with insufficient evidence of complete coverage for the metric. |
| `unknown` | No posts were observed and coverage cannot confirm an empty collection. The post count is `null`. | There are no measured posts and coverage cannot confirm zero. Both total and average are `null`. |

When post coverage confirms an empty collection and engagement coverage confirms a complete zero, each engagement metric has a total of `0`, an average of `null` and `0` measured posts. Otherwise, when values are available, the average uses `measuredPosts` as its denominator. For example, with one measured zero and one missing value, the metric is partial and the average is zero across one measured post.

Incomplete post coverage, incomplete engagement coverage, and missing per-post values can each make a metric partial. Use both coverage lists and the number of posts with a known value when explaining why a metric is partial.

To distinguish a confirmed empty collection from an omitted collection, request `app.bsky.feed.post` explicitly when fetching the snapshot. The reply and undated counts always describe observed rows. The UI should show the activity status alongside these counts and the timeline.

The activity timeline groups observed posts by publication day. A missing day can be shown as a confirmed zero only when post coverage is complete and `undatedPosts` is zero. Engagement figures describe the collection snapshot at `fetchedAt`. They provide no timestamps for individual interactions.
