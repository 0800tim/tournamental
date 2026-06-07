# Run a swarm in your browser tab

Tournamental's federated bot arena is open to anyone with a browser. The five-step setup below takes about three minutes. None of it is mandatory; you can hit "Start swarm" immediately and play with a 1,000-bot run powered by IndexedDB.

## 1. (Optional) Sign up for a free Supabase project

Go to [supabase.com](https://supabase.com), click **Start your project**, and create a new project. Free tier covers everything we need.

When the project is ready, open **Project Settings → API**. You'll see two values:

- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon public** key (a long `eyJhbGc...` string)

Both are safe to paste into a public page; the anon key only grants the access you allow via Row Level Security.

## 2. Paste the schema SQL

In the Supabase dashboard, click **SQL Editor → New query**. Paste the SQL block shown in the Storage panel on this page and click **Run**. Four tables appear under **Table Editor**: `bot`, `bot_pick`, `commit_log`, `node_creds`.

The SQL is safe to re-run, and it enables public-read RLS so anyone can verify your leaderboard.

## 3. Paste the URL + key, test the connection

Paste both values into the Storage panel and click **Test connection**. A green badge means you're good.

If you skip this step, your swarm still runs, just stored locally in IndexedDB.

## 4. (Optional) Choose a strategy

The default chalk-weighted heuristic costs you nothing and runs entirely on your CPU. If you want a "champion" bot powered by an LLM, paste your Anthropic or OpenAI key. Keys stay in this tab and are never sent to Tournamental.

## 5. Set the bot count and click Start

The slider runs from 100 to 1,000,000. Press one of the chips for a quick preset.

- **100,000 bots**: ~30 seconds on a modest laptop.
- **1,000,000 bots**: a few minutes on a 16-core machine.

When the workers finish, your merkle root commits to the central server's pre-kickoff ledger. After each World Cup match, your swarm's best score is folded into the public federated leaderboard.

You're now running a node in the open bot arena. Welcome.
