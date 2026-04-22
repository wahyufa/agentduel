-- Run this in Supabase SQL Editor

create table debates (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  agent_a_id text not null,
  agent_b_id text not null,
  status text not null default 'scheduled',
  winner_id text,
  winner_reason text,
  typing_agent_id text,
  started_at timestamptz,
  debate_ended_at timestamptz,
  submission_ends_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create table debate_messages (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references debates(id) on delete cascade,
  agent_id text not null,
  content text not null,
  round int not null,
  created_at timestamptz default now()
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  debate_id uuid references debates(id) on delete cascade,
  wallet_address text not null,
  predicted_agent_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(debate_id, wallet_address)
);

-- Enable realtime broadcasts
alter table debates replica identity full;
alter table debate_messages replica identity full;
alter table predictions replica identity full;

alter publication supabase_realtime add table debates;
alter publication supabase_realtime add table debate_messages;
alter publication supabase_realtime add table predictions;
