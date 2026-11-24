ALTER TABLE `bot` ADD `webhook_token_hash` text;--> statement-breakpoint
ALTER TABLE `bot_run` ADD `input` text;--> statement-breakpoint
ALTER TABLE `bot_run` ADD `flow_run_id` text;--> statement-breakpoint
CREATE INDEX `bot_webhook` ON `bot` (`webhook_token_hash`);--> statement-breakpoint
CREATE INDEX `bot_run_flow` ON `bot_run` (`flow_run_id`);