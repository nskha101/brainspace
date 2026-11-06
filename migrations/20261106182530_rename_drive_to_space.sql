-- "Drive" is now "space". Rewrite flow destinations and delivery records that
-- were saved with to: "drive", and links that point at /app/drive/.
UPDATE `flow_trigger` SET `deliver` = replace(`deliver`, '"to":"drive"', '"to":"space"') WHERE `deliver` LIKE '%"to":"drive"%';--> statement-breakpoint
UPDATE `flow_run` SET `deliver` = replace(`deliver`, '"to":"drive"', '"to":"space"') WHERE `deliver` LIKE '%"to":"drive"%';--> statement-breakpoint
UPDATE `flow_run` SET `deliveries` = replace(replace(`deliveries`, '"to":"drive"', '"to":"space"'), '/app/drive/', '/app/space/') WHERE `deliveries` LIKE '%drive%';
