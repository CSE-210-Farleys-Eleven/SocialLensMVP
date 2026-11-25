/** TEMPORARY — copied (simplified) from Test_Module_SocialLens@2b2e993 src/analytics/contract.ts
 *  (`Histogram`, `Streak`, `WeekOverWeek`, `TopPost`). PR #20 does not compute these.
 *  Replace with `import type` from src/analytics/contract if the analytics owner adds them, or drop.
 *  Tracked in transition/ui/README.md#temporary-inputs.
 */
import type { AtUri, IsoDateTime } from '../../adapters/contract';
import type { TemporaryCoverageStatus } from './analytics-pr20';

export interface TemporaryHistogram {
  /** 24 bins (hours "00".."23") or 7 bins ("Mon".."Sun"), zero-filled, UTC. */
  bins: { label: string; count: number }[];
  status: TemporaryCoverageStatus;
}

export interface TemporaryCount {
  value: number | null;
  status: TemporaryCoverageStatus;
}

export interface TemporaryTopPost {
  rank: number;
  uri: AtUri;
  createdAt: IsoDateTime | null;
  /** Source text, truncated. Render as text only. */
  textPreview: string | null;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number | null;
  /** Younger than 36 hours: counters still moving. */
  settling: boolean;
}

export interface TemporaryExtendedActivity {
  hours: TemporaryHistogram;
  weekdays: TemporaryHistogram;
  streak: {
    current: TemporaryCount;
    longest: TemporaryCount;
    currentStart: string | null;
    currentEnd: string | null;
    longestStart: string | null;
    longestEnd: string | null;
  };
  weekOverWeek: {
    current: { startDate: string; endDate: string; posts: TemporaryCount };
    previous: { startDate: string; endDate: string; posts: TemporaryCount };
    /** current − previous; null when either side is unknown. */
    delta: number | null;
  };
  topPosts: TemporaryTopPost[];
}
