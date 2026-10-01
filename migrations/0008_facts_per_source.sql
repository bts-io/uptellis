-- Facts and fact samples keyed by source as well: the two nodes of a failover pair report the same keys.
-- Existing samples take the source of their fact row (empty when it is gone). No foreign keys involved.
CREATE TABLE `__new_fact_samples` (
	`site` text NOT NULL,
	`source` text NOT NULL,
	`grp` text NOT NULL,
	`key` text NOT NULL,
	`ts` integer NOT NULL,
	`value` real NOT NULL,
	PRIMARY KEY(`site`, `source`, `grp`, `key`, `ts`)
);
--> statement-breakpoint
INSERT INTO `__new_fact_samples`("site", "source", "grp", "key", "ts", "value") SELECT s."site", coalesce((SELECT f."source" FROM `facts` f WHERE f."site" = s."site" AND f."grp" = s."grp" AND f."key" = s."key"), ''), s."grp", s."key", s."ts", s."value" FROM `fact_samples` s;--> statement-breakpoint
DROP TABLE `fact_samples`;--> statement-breakpoint
ALTER TABLE `__new_fact_samples` RENAME TO `fact_samples`;--> statement-breakpoint
CREATE INDEX `fact_samples_ts_idx` ON `fact_samples` (`ts`);--> statement-breakpoint
CREATE TABLE `__new_facts` (
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
	PRIMARY KEY(`site`, `source`, `grp`, `key`)
);
--> statement-breakpoint
INSERT INTO `__new_facts`("site", "grp", "key", "source", "value_type", "value_text", "value_num", "value_bool", "unit", "severity", "observed_at", "fresh_for_s") SELECT "site", "grp", "key", "source", "value_type", "value_text", "value_num", "value_bool", "unit", "severity", "observed_at", "fresh_for_s" FROM `facts`;--> statement-breakpoint
DROP TABLE `facts`;--> statement-breakpoint
ALTER TABLE `__new_facts` RENAME TO `facts`;