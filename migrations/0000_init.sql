CREATE TABLE `fact_samples` (
	`site` text NOT NULL,
	`grp` text NOT NULL,
	`key` text NOT NULL,
	`ts` integer NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`site`, `grp`, `key`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `fact_samples_ts_idx` ON `fact_samples` (`ts`);--> statement-breakpoint
CREATE TABLE `facts` (
	`site` text NOT NULL,
	`grp` text NOT NULL,
	`key` text NOT NULL,
	`source` text NOT NULL,
	`value_type` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`value_bool` integer,
	`unit` text,
	`severity` text,
	`observed_at` integer NOT NULL,
	`fresh_for_s` integer NOT NULL,
	PRIMARY KEY(`site`, `grp`, `key`)
);
--> statement-breakpoint
CREATE TABLE `heartbeat_5m` (
	`site` text NOT NULL,
	`service_id` text NOT NULL,
	`bucket` integer NOT NULL,
	`total` integer NOT NULL,
	`up` integer NOT NULL,
	`down` integer NOT NULL,
	`maint` integer NOT NULL,
	`pending` integer NOT NULL,
	`ping_avg` real,
	`ping_max` real,
	PRIMARY KEY(`site`, `service_id`, `bucket`)
);
--> statement-breakpoint
CREATE INDEX `heartbeat_5m_bucket_idx` ON `heartbeat_5m` (`bucket`);--> statement-breakpoint
CREATE TABLE `heartbeats` (
	`site` text NOT NULL,
	`service_id` text NOT NULL,
	`ts` integer NOT NULL,
	`status` text NOT NULL,
	`latency_ms` real,
	`message` text,
	`important` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`site`, `service_id`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `heartbeats_ts_idx` ON `heartbeats` (`ts`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`site` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`service_id` text,
	`source_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`title` text NOT NULL,
	`notes` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `id`)
);
--> statement-breakpoint
CREATE INDEX `incidents_site_ended_idx` ON `incidents` (`site`,`ended_at`);--> statement-breakpoint
CREATE INDEX `incidents_site_started_idx` ON `incidents` (`site`,`started_at`);--> statement-breakpoint
CREATE TABLE `ingest_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ingest_nonces_expires_idx` ON `ingest_nonces` (`expires_at`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site` text NOT NULL,
	`source_id` text NOT NULL,
	`received_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`generated_at` integer NOT NULL,
	`ok` integer NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_site_source_received_idx` ON `snapshots` (`site`,`source_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `snapshots_received_idx` ON `snapshots` (`received_at`);--> statement-breakpoint
CREATE TABLE `services` (
	`site` text NOT NULL,
	`id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target_display` text,
	`interval_s` integer,
	`method` text,
	`timeout_s` real,
	`status` text NOT NULL,
	`latency_ms` real,
	`avg_latency_ms` real,
	`uptime24h` real,
	`uptime30d` real,
	`cert` text,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`site`, `id`)
);
--> statement-breakpoint
CREATE TABLE `site_configs` (
	`site` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`saved_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `version`)
);
--> statement-breakpoint
CREATE TABLE `sites` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hostnames` text NOT NULL,
	`config_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`site` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`expected_interval_s` integer NOT NULL,
	`last_seen_at` integer,
	`last_ok_at` integer,
	`last_error` text,
	`key_id` text,
	`secret_sealed` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `id`)
);
--> statement-breakpoint
CREATE INDEX `sources_key_id_idx` ON `sources` (`key_id`);