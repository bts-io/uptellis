CREATE TABLE `notifications` (
	`site` text NOT NULL,
	`incident_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`sent_at` integer,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`site`, `incident_id`, `kind`)
);
