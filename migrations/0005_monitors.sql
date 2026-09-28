CREATE TABLE `monitor_runners` (
	`site` text NOT NULL,
	`monitor_id` text NOT NULL,
	`runner` text NOT NULL,
	`last_ts` integer NOT NULL,
	`last_status` text NOT NULL,
	`consecutive_down` integer NOT NULL,
	`latency_ms` real,
	`message` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `monitor_id`, `runner`)
);
