// Site settings. Edit this file, commit, and push.

// Shared storage. Leave as null and the site runs in "local mode": every
// visitor's picks stay in their own browser. To share one pool with everyone,
// create a free Firebase project and paste its web app config here (see README).
// The Firebase web config is not a secret; access is controlled by
// database.rules.json.
export const FIREBASE_CONFIG = null;
/* Example:
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  appId: "1:1234567890:web:abc123"
};
*/

// Season settings. For a new season, bump SEASON and set WEEK1_START to the
// Tuesday before the opening game. Each season gets a fresh board.
export const SEASON = 2026;
export const WEEK1_START = "2026-09-08";

export const POOL_TITLE = "Pick'em Pool";
