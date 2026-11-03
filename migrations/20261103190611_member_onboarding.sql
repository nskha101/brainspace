ALTER TABLE `member` ADD `onboarded_at` integer;--> statement-breakpoint
ALTER TABLE `member` ADD `agent_seen_at` integer;--> statement-breakpoint
ALTER TABLE `member` ADD `agent_client` text;--> statement-breakpoint
-- People who joined before the welcome flow existed shouldn't be sent through it.
UPDATE `member` SET `onboarded_at` = `created_at` WHERE `onboarded_at` IS NULL;
