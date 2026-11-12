// Shapes from the /v1 OpenAPI document (cosend.app/docs/reference). `/v1` changes are additive, so
// every response type carries an index signature for fields added later, and response enums are
// `Open<…>`: the listed values, plus any string a later release adds.

/** The listed values, or a value a later release of the API adds. */
export type Open<T extends string> = T | (string & {});

/** A query-string value. Arrays repeat the key; `undefined` is left out. */
export type QueryValue = string | number | boolean | string[] | undefined;

/** One page of a cursor-paginated list. Treat `next_cursor` as opaque. */
export interface Page<T> {
  data: T[];
  has_more: boolean;
  /** `null` when `has_more` is `false`. */
  next_cursor: string | null;
}

/** `GET /v1/me`: the calling credential, its workspace, plan and limits. */
export interface Me {
  /** The person behind the credential; `null` for an API key. */
  user: { id: string; email: string; name: string; [key: string]: unknown } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    country: string | null;
    erasure_scheduled_for: string | null;
    [key: string]: unknown;
  };
  credential: {
    kind: Open<"connection" | "organization" | "oauth" | "dashboard">;
    id: string;
    name: string;
    is_live: boolean;
    scopes: string[];
    connection_id: string | null;
    connection_ids: string[];
    [key: string]: unknown;
  };
  /** The WhatsApp numbers this credential works with. A message is sent from one of them. */
  connections: Array<{
    id: string;
    display_phone_number: string;
    verified_name: string | null;
    mode: Open<"coexistence" | "cloud_api">;
    status: Open<
      | "pending"
      | "active"
      | "needs_reauth"
      | "payment_blocked"
      | "restricted"
      | "disconnected"
      | "offboarded"
    >;
    [key: string]: unknown;
  }>;
  subscription: {
    plan: string;
    status: string;
    effective_plan_code: string;
    overdue: boolean;
    current_period_end: string;
    [key: string]: unknown;
  };
  /** Each plan allowance, by name. */
  limits: Record<
    string,
    {
      included: number | null;
      used: number | null;
      hard_cap: number | null;
      basis: Open<"period" | "lifetime" | "concurrent">;
      remaining: number | null;
      warning_level: number | null;
      [key: string]: unknown;
    }
  >;
  /** Each feature, by name: `entitled`, and when it is not, why and where to upgrade. */
  entitlements: Record<string, { entitled: boolean; [key: string]: unknown }>;
  [key: string]: unknown;
}

export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contacts"
  | "interactive"
  | "template"
  | "reaction";

export type MessageSource =
  | "customer"
  | "app"
  | "api"
  | "agent"
  | "automation"
  | "ai"
  | "notify"
  | "history"
  | "system";

/** Meta's media object. `id` may be a Cosend media id (`med_…`, from `POST /v1/media`). */
export interface MediaObject {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
  [key: string]: unknown;
}

/**
 * The body of `POST /v1/messages`. Name the recipient with exactly one of `to` (E.164),
 * `contact_id` or `conversation_id`. The API refuses fields it does not define (`unknown_field`).
 */
export interface SendMessageBody {
  /** The number it goes out from. Optional with a connection key, which already names it. */
  connection_id?: string;
  to?: string;
  contact_id?: string;
  conversation_id?: string;
  type: MessageType;
  text?: { body: string; [key: string]: unknown };
  image?: MediaObject;
  audio?: MediaObject;
  video?: MediaObject;
  document?: MediaObject;
  sticker?: MediaObject;
  location?: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  /** Meta's interactive object. */
  interactive?: Record<string, unknown>;
  /** Meta's template object: `{ name, language: { code }, components }`. */
  template?: Record<string, unknown>;
  reaction?: { message_id: string; emoji: string };
  /** The id of the message this one replies to. */
  reply_to?: string | null;
  /** Your own keys and string values. Stored by Cosend and echoed on webhooks. */
  metadata?: Record<string, string>;
  /** Who is sending. Left out, an API key sends as `api`. */
  source?: MessageSource;
  /** Default `strict`. */
  send_mode?: "auto" | "strict";
  /** The approved template to send instead when the service window is closed. */
  fallback_template?: { name: string; language: string };
  [key: string]: unknown;
}

/** The message resource, as `POST /v1/messages` and `GET /v1/messages/{id}` return it. */
export interface Message {
  id: string;
  object: "message";
  conversation_id: string;
  contact_id: string;
  connection_id: string;
  /** WhatsApp's message id, once Meta has one. */
  wamid: string | null;
  direction: Open<"inbound" | "outbound">;
  source: Open<MessageSource>;
  status: Open<
    | "queued"
    | "sending"
    | "sent"
    | "delivered"
    | "read"
    | "played"
    | "failed"
    | "deleted"
    | "received"
  >;
  type: string;
  content: Record<string, unknown>;
  metadata: Record<string, string>;
  created_at: string;
  error_code: number | null;
  error_title: string | null;
  error_detail: string | null;
  /** On the response to a send: whether it went out free-form or as the fallback template. */
  send_mode_used?: Open<"freeform" | "template">;
  [key: string]: unknown;
}

export type ConversationState = "open" | "pending" | "snoozed" | "resolved";
export type ConversationControl = "bot" | "pending_human" | "human" | "app";
export type ConversationPriority = "normal" | "priority" | "high_priority";
export type WindowState = "open" | "closing" | "expiring" | "closed";

/** The conversation resource, as `GET /v1/conversations` lists it. */
export interface Conversation {
  id: string;
  object: "conversation";
  connection_id: string;
  contact_id: string;
  state: Open<ConversationState>;
  control: Open<ConversationControl>;
  assignee_id: string | null;
  unread_count: number;
  message_count: number;
  last_message_at: string | null;
  snoozed_until: string | null;
  /** The 24-hour customer service window. */
  window: {
    service_window_open: boolean;
    service_window_expires_at: string | null;
    free_entry_point_expires_at: string | null;
    can_send_freeform: boolean;
    expires_in_seconds: number | null;
    state: Open<"open" | "expiring" | "closed">;
    band: Open<WindowState>;
    [key: string]: unknown;
  };
  priority: Open<ConversationPriority>;
  labels: string[];
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  last_read_at: string | null;
  /** The contact with `expand=contact`; `null` otherwise. */
  contact: { id: string; [key: string]: unknown } | null;
  /** The newest message with `expand=last_message`; `null` otherwise. */
  last_message: Message | null;
  /** The number with `expand=connection`; `null` otherwise. */
  connection: {
    id: string;
    verified_name: string | null;
    display_phone_number: string;
    delivery_mode: Open<"stored" | "direct">;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

/** `true` or `false`, sent as the strings the API reads. */
type Flag = boolean | "true" | "false";

/** The query of `GET /v1/conversations`. */
export interface ListConversationsParams {
  /** Default 25, maximum 100. */
  limit?: number;
  after?: string;
  before?: string;
  /** Searches the contact and the newest message (page size 20 under `q`). */
  q?: string;
  state?: ConversationState;
  control?: ConversationControl;
  assignee_id?: string;
  assignee?: "none" | "me";
  /** One number, or several (the key repeats in the query string). */
  connection_id?: string | string[];
  /** Include direct-mode numbers when no `connection_id` is named. */
  include_direct?: Flag;
  label?: string;
  unread?: Flag;
  /** `true`: the chats waiting for an answer; `false`: the rest. */
  waiting?: Flag;
  /** @deprecated Use `waiting`; kept by the API for one release. */
  needs_person?: Flag;
  window_state?: WindowState | WindowState[];
  order?: "recent" | "urgency" | "waiting_longest";
  priority?: ConversationPriority;
  /** The chats with replies to this campaign (`cmp_…`). */
  campaign_id?: string;
  /** Comma-separated: `contact`, `last_message`, `connection`. */
  expand?: string;
  [key: string]: QueryValue;
}
