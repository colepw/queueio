-- ─────────────────────────────────────────────
-- QueueIO — Supabase SQL Setup
-- Run this entire file in your Supabase project:
--   Dashboard → SQL Editor → New Query → Paste → Run
-- ─────────────────────────────────────────────

-- ROOMS table
create table if not exists rooms (
  code       text primary key,         -- 4-char alphanumeric code
  owner_id   text not null,            -- session ID of the room creator
  created_at timestamptz default now()
);

-- QUESTIONS table
create table if not exists questions (
  id         bigserial primary key,
  room_code  text not null references rooms(code) on delete cascade,
  text       text not null,
  up         integer not null default 0,
  down       integer not null default 0,
  created_at timestamptz default now()
);

-- Index for fast room lookups
create index if not exists questions_room_code_idx on questions(room_code);

-- ─── Row Level Security ───
alter table rooms     enable row level security;
alter table questions enable row level security;

-- Anyone can read rooms (needed to validate a join code)
create policy "rooms: public read"
  on rooms for select using (true);

-- Anyone can insert a room (they become the owner via owner_id in app)
create policy "rooms: public insert"
  on rooms for insert with check (true);

-- Anyone can read questions
create policy "questions: public read"
  on questions for select using (true);

-- Anyone can insert a question
create policy "questions: public insert"
  on questions for insert with check (true);

-- Anyone can update a question (votes; owner check is enforced in app)
create policy "questions: public update"
  on questions for update using (true);

-- Anyone can delete a question (answered; owner check is enforced in app)
create policy "questions: public delete"
  on questions for delete using (true);

-- ─── Realtime ───
-- Enable realtime for both tables so clients receive live updates.
-- Run these in the SQL editor too:
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table questions;
