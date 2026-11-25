/** TEMPORARY — copied (simplified) from Test_Module_SocialLens@2b2e993 src/analytics/privacy/contract.ts
 *  and src/shared/contract.ts (`Citation`). No module produces privacy observations on main.
 *  Replace with `import type` from the privacy module's contract once one is agreed.
 *  Tracked in transition/ui/README.md#temporary-inputs.
 */
import type { AtUri, IsoDateTime, Nsid } from '../../adapters/contract';

export interface TemporaryCitation {
  title: string;
  publisher: string;
  url: string;
  /** YYYY-MM-DD the URL was last checked. */
  accessed: string;
}

export interface TemporaryObservation {
  id: string;
  title: string;
  summary: string;
  evidence: {
    /** null when the count is unknown. */
    count: number | null;
    countCertainty: 'exact' | 'lower-bound' | 'unknown';
    /** The person's OWN record URIs. Render as text. */
    sampleUris: AtUri[];
    earliestAt: IsoDateTime | null;
    latestAt: IsoDateTime | null;
    collections: Nsid[];
    details: { label: string; value: string }[];
  };
  source: TemporaryCitation;
  limitation: string;
  action: string;
}

export interface TemporaryPrivacyReport {
  observations: TemporaryObservation[];
  notTriggered: { id: string; title: string; reason: string }[];
}
