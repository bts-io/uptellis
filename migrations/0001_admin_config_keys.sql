CREATE TABLE `ingest_keys` (
	`key_id` text PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`source` text NOT NULL,
	`current_sealed` text,
	`current_created_at` integer,
	`next_sealed` text,
	`next_created_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `site_configs` ADD `note` text;