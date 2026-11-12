create table if not exists events (
  id text primary key,
  title text not null,
  event_date text,
  location text not null default '',
  status text not null default 'Upcoming' check (status in ('Upcoming', 'Completed', 'Draft')),
  summary text not null default '',
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp
);

create table if not exists impact_stories (
  id text primary key,
  title text not null,
  story_date text,
  location text not null default '',
  image_url text not null default '',
  summary text not null default '',
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp
);

create table if not exists leadership (
  id text primary key,
  name text not null,
  role text not null,
  image_url text not null default '',
  bio text not null default '',
  sort_order integer not null default 0,
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp
);

create table if not exists page_content (
  id text primary key,
  page_slug text not null,
  section_key text not null,
  title text not null,
  body text not null default '',
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp,
  unique (page_slug, section_key)
);

create table if not exists donation_options (
  id text primary key,
  title text not null,
  donation_type text not null default 'One-time',
  description text not null default '',
  details text not null default '',
  sort_order integer not null default 0,
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp
);

create table if not exists media_assets (
  id text primary key,
  title text not null,
  media_type text not null check (media_type in ('image', 'video')),
  file_path text not null unique,
  alt_text text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  published integer not null default 0 check (published in (0, 1)),
  created_at text not null default current_timestamp
);

create index if not exists events_public_date_idx on events (event_date) where published = 1;
create index if not exists impact_stories_public_date_idx on impact_stories (story_date desc) where published = 1;
create index if not exists leadership_public_order_idx on leadership (sort_order, created_at) where published = 1;
create index if not exists page_content_public_page_idx on page_content (page_slug) where published = 1;
create index if not exists donation_options_public_order_idx on donation_options (sort_order, created_at) where published = 1;
create index if not exists media_assets_public_order_idx on media_assets (sort_order, created_at) where published = 1;