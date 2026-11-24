CREATE TABLE `slack_event` (
	`id` text PRIMARY KEY,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slack_inbox` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`token` text NOT NULL,
	`scope` text,
	`bot_id` text,
	`dms` integer DEFAULT true NOT NULL,
	`mentions` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_event_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_slack_inbox_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_inbox_ws_user` ON `slack_inbox` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `slack_inbox_slack` ON `slack_inbox` (`slack_team_id`,`slack_user_id`);