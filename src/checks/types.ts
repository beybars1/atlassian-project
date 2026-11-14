/**
 * Shared types for checks. Checks are pure functions over a PageRecord plus
 * injected clients, so they run in unit tests without the Forge runtime.
 */

export type Severity = "high" | "medium" | "low";

export type CheckCode =
  | "DEAD_LINK"
  | "OWNER_GONE"
  | "JIRA_REF_DRIFT"
  | "PLACEHOLDER"
  | "STALE_BY_TYPE"
  | "CONTRADICTION";

export interface Finding {
  pageId: string;
  check: CheckCode;
  severity: Severity;
  /** Short, specific evidence: what was found and where. */
  evidence: string;
  /** What the page owner should do. */
  suggestion: string;
}

export interface PageLink {
  /** Raw href or resolved target description. */
  href: string;
  /** Internal Confluence page by title (from <ri:page>). */
  pageTitle?: string;
  spaceKey?: string;
  /** Internal Confluence page by numeric id (from /wiki/spaces/KEY/pages/123). */
  pageId?: string;
  /** Jira issue key (from /browse/KEY-1 or a jira macro). */
  issueKey?: string;
  external: boolean;
}

/** A reference to a Confluence attachment found in the page body. */
export interface AttachmentRef {
  /** Filename exactly as written in the page (entity- and URL-decoded). */
  filename: string;
  /** `image` = <ac:image>, `link` = <ac:link> or a file macro, `download` = /wiki/download/attachments/… href. */
  kind: "image" | "link" | "download";
  /** Owning page when it is not this page (download links carry the id). */
  pageId?: string;
  /** Owning page referenced by title (<ri:attachment><ri:page …/></ri:attachment>); not resolvable here. */
  pageTitle?: string;
  spaceKey?: string;
}

/** Same-page anchor material: what the page links to and what it defines. */
export interface PageAnchors {
  /** `#target` hrefs and <ac:link ac:anchor> without a page reference, in document order. */
  targets: string[];
  /** Anchor macro names and element `id` attributes. */
  names: string[];
  /** Heading texts (h1–h6) in document order; Confluence derives anchors from them. */
  headings: string[];
  /** True when an include / excerpt-include macro can bring anchors from another page. */
  hasIncludes: boolean;
}

export interface PageRecord {
  id: string;
  spaceId: string;
  spaceKey?: string;
  title: string;
  version: number;
  ownerId?: string;
  lastEditorId?: string;
  lastModified: string; // ISO date
  labels: string[];
  /** Plain text extracted from storage format. */
  text: string;
  links: PageLink[];
  /** Jira issue keys mentioned in text or macros. */
  issueKeys: string[];
  /** Attachment references in the body (T12). */
  attachments: AttachmentRef[];
  /** Same-page anchor targets and definitions (T12). */
  anchors: PageAnchors;
}

export interface IssueInfo {
  key: string;
  exists: boolean;
  summary?: string;
  statusName?: string;
  /** Jira status category key: "new" | "indeterminate" | "done" */
  statusCategory?: string;
  resolved?: boolean;
  /** Set when the issue was moved and the key redirected to another key. */
  movedTo?: string;
}

export interface ComponentInfo {
  id: string;
  name: string;
  archived: boolean;
}

export interface VersionInfo {
  id: string;
  name: string;
  archived: boolean;
  released: boolean;
  /** ISO date when Jira has one. */
  releaseDate?: string;
}

export interface Clients {
  confluence: {
    pageExistsById(pageId: string): Promise<boolean>;
    pageExistsByTitle(spaceKey: string, title: string): Promise<boolean>;
    /**
     * Filenames of the current attachments of a page. `undefined` when the list could not be
     * fetched (missing scope, error, page gone) — the check then flags nothing.
     */
    attachmentFilenames(pageId: string): Promise<string[] | undefined>;
  };
  jira: {
    getIssue(key: string): Promise<IssueInfo>;
    /** Project keys that exist on the site; used to avoid false positives like "ISO-9001". */
    knownProjectKeys(): Promise<Set<string>>;
    /** Components of a project. Empty on any error — the check then flags nothing. */
    getComponents(projectKey: string): Promise<ComponentInfo[]>;
    /** Versions (fixVersions) of a project. Empty on any error — the check then flags nothing. */
    getVersions(projectKey: string): Promise<VersionInfo[]>;
  };
  users: {
    isActive(accountId: string): Promise<boolean | undefined>;
  };
  now(): Date;
}

export type Check = (page: PageRecord, clients: Clients) => Promise<Finding[]>;
