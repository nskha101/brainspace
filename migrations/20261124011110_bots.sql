CREATE TABLE `bot` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text NOT NULL,
	`visibility` text NOT NULL,
	`owner_id` text NOT NULL,
	`model` text,
	`cron` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`tools` text,
	`connections` text,
	`paths` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`next_run_at` integer,
	`last_run_id` text,
	`last_run_at` integer,
	`last_status` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_bot_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bot_run` (
	`id` text PRIMARY KEY,
	`bot_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`started_by` text,
	`prompt` text,
	`model` text,
	`summary` text,
	`error` text,
	`steps` integer DEFAULT 0 NOT NULL,
	`tokens` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_bot_run_bot_id_bot_id_fk` FOREIGN KEY (`bot_id`) REFERENCES `bot`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bot_run_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`run_id` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`kind` text NOT NULL,
	`agent` text,
	`name` text,
	`input` text,
	`output` text,
	`ok` integer DEFAULT true NOT NULL,
	CONSTRAINT `fk_bot_run_event_run_id_bot_run_id_fk` FOREIGN KEY (`run_id`) REFERENCES `bot_run`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_ws_owner_name` ON `bot` (`workspace_id`,`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `bot_ws` ON `bot` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `bot_run_bot` ON `bot_run` (`bot_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bot_run_ws` ON `bot_run` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `bot_run_event_run` ON `bot_run_event` (`run_id`,`id`);