CREATE TABLE `__new_notifications` (
	`site` text NOT NULL,
	`incident_id` text NOT NULL,
	`kind` text NOT NULL,
	`channel` text DEFAULT 'discord' NOT NULL,
	`status` text NOT NULL,
	`sent_at` integer,
	`error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`retryable` integer DEFAULT false NOT NULL,
	`last_attempt_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `incident_id`, `kind`, `channel`)
);
--> statement-breakpoint
INSERT INTO `__new_notifications`("site", "incident_id", "kind", "channel", "status", "sent_at", "error", "attempts", "retryable", "last_attempt_at", "created_at") SELECT "site", "incident_id", "kind", 'discord', "status", "sent_at", "error", 1, false, coalesce("sent_at", "created_at"), "created_at" FROM `notifications`;--> statement-breakpoint
DROP TABLE `notifications`;--> statement-breakpoint
ALTER TABLE `__new_notifications` RENAME TO `notifications`;
