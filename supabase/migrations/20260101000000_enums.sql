-- =============================================================================
-- 00 — Extensions and enums
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "unaccent" with schema extensions;

create type user_role            as enum ('candidate', 'employer', 'admin');
create type job_track            as enum ('primary', 'resale', 'rental', 'commercial', 'property_management', 'back_office');
create type employment_type      as enum ('full_time', 'part_time', 'freelance_commission_only');
create type experience_band      as enum ('fresh_0_1', 'junior_1_3', 'mid_3_5', 'senior_5_plus');
create type leads_source         as enum ('company_provided', 'self_generated', 'hybrid');
create type commission_type      as enum ('percentage', 'split', 'undisclosed', 'none');
create type job_status           as enum ('draft', 'pending_review', 'active', 'expired', 'closed', 'rejected');
create type application_status   as enum ('new', 'shortlisted', 'interview', 'hired', 'rejected');
create type verification_status  as enum ('unverified', 'pending', 'verified', 'rejected');
create type agent_visibility     as enum ('public', 'verified_employers_only', 'hidden');
create type agent_availability   as enum ('open_to_offers', 'employed_not_looking', 'actively_searching');
