-- Full-text index over doc names, paths, descriptions and content.
-- Maintained by the app in the same batch as each write (src/server/services/search.ts).
CREATE VIRTUAL TABLE `node_fts` USING fts5(
  `node_id` UNINDEXED,
  `workspace_id` UNINDEXED,
  `drive_id` UNINDEXED,
  `name`,
  `path`,
  `content`,
  tokenize = 'porter unicode61'
);
