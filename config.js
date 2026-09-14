// Site settings. Edit this file, commit, and push.

// Shared storage. Leave as null and the site runs in "local mode": every
// visitor's picks stay in their own browser. To share one pool with everyone,
// create a free Firebase project and paste its web app config here (see README).
// The Firebase web config is not a secret; access is controlled by
// database.rules.json.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDS5EDS1ScIkzjBMR5YOK0EUSqA9eqz92Q",
  authDomain: "nfl-pick-em-pool-a4ccd.firebaseapp.com",
  databaseURL: "https://nfl-pick-em-pool-a4ccd-default-rtdb.firebaseio.com",
  projectId: "nfl-pick-em-pool-a4ccd",
  storageBucket: "nfl-pick-em-pool-a4ccd.firebasestorage.app",
  messagingSenderId: "151841864331",
  appId: "1:151841864331:web:4d87b26739c1890d00728e"
};

// Season settings. For a new season, bump SEASON and set WEEK1_START to the
// Tuesday before the opening game. Each season gets a fresh board.
export const SEASON = 2026;
export const WEEK1_START = "2026-09-08";

export const POOL_TITLE = "Pick'em Pool";
