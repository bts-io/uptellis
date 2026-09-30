CREATE TABLE `push_tokens` (
	`site` text NOT NULL,
	`monitor_id` text NOT NULL,
	`token_hash` text,
	`token_created_at` integer,
	`last_push_at` integer,
	`watch_since` integer,
	`config_version` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `monitor_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_tokens_token_hash_idx` ON `push_tokens` (`token_hash`);