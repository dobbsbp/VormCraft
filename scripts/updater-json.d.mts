// Types for updater-json.mjs, so the tests can use it.
export declare const PLATFORMS: { ending: string; keys: string[] }[];
export declare function updaterJson(args: {
  repo: string;
  tag: string;
  notes: string;
  pubDate: string;
  assets: string[];
  signature(name: string): string;
}): {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
};
