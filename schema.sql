-- Run this once in the Supabase SQL Editor to create the tables the app needs.

create table if not exists contracts (
  id            text primary key,
  title         text not null,
  original_name text not null,
  storage_path  text not null,
  mime_type     text not null,
  uploaded_at   timestamptz not null default now()
);

create table if not exists entries (
  id          text primary key,
  contract_id text not null references contracts(id) on delete cascade,
  name        text not null,
  id_number   text not null,
  signature   text not null,
  created_at  timestamptz not null default now()
);

create index if not exists entries_contract_id_idx on entries(contract_id);
