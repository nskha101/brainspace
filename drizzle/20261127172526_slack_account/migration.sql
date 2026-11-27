CREATE TABLE `slack_account` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slack_team_id` text NOT NULL,
	`slack_team_name` text,
	`slack_user_id` text NOT NULL,
	`token` text NOT NULL,
	`scope` text,
	`last_event_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_slack_account_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_slack_account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `slack_post` (
	`slack_team_id` text NOT NULL,
	`channel` text NOT NULL,
	`ts` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `slack_post_pk` PRIMARY KEY(`slack_team_id`, `channel`, `ts`),
	CONSTRAINT `fk_slack_post_workspace_id_workspace_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `flow_trigger` ADD `slack` text;--> statement-breakpoint
CREATE UNIQUE INDEX `slack_account_ws_user` ON `slack_account` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `slack_account_slack` ON `slack_account` (`slack_team_id`,`slack_user_id`);--> statement-breakpoint
CREATE INDEX `slack_post_created` ON `slack_post` (`created_at`);