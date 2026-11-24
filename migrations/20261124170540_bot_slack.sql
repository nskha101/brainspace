CREATE TABLE `bot_slack_thread` (
	`id` text PRIMARY KEY,
	`slack_team_id` text NOT NULL,
	`channel` text NOT NULL,
	`thread_ts` text NOT NULL,
	`bot_id` text NOT NULL,
	`slack_user_id` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_bot_slack_thread_bot_id_bot_id_fk` FOREIGN KEY (`bot_id`) REFERENCES `bot`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `bot` ADD `slack_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bot` ADD `slack_connection_id` text;--> statement-breakpoint
ALTER TABLE `bot` ADD `slack_team_id` text;--> statement-breakpoint
ALTER TABLE `bot` ADD `slack_group_id` text;--> statement-breakpoint
ALTER TABLE `bot` ADD `slack_handle` text;--> statement-breakpoint
CREATE INDEX `bot_slack` ON `bot` (`slack_team_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bot_slack_thread_key` ON `bot_slack_thread` (`slack_team_id`,`channel`,`thread_ts`);--> statement-breakpoint
CREATE INDEX `bot_slack_thread_at` ON `bot_slack_thread` (`updated_at`);