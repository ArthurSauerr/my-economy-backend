CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
 
create table users(
	id UUID primary key default uuid_generate_v4(),
	name varchar(100) not null,
	email varchar(100) not null,
	password varchar(100) not null,
	birthdate date not null
);
 
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    description TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    reference_month DATE NOT NULL,
    user_id UUID,
    CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id)
);
 
CREATE TABLE user_limit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    reference_month DATE NOT NULL,
    limit_amount NUMERIC(10,2) NOT NULL,
    CONSTRAINT fk_user_limit FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, reference_month)
);
 
select * from users;
select * from expenses;
select * from user_limit;

drop table user;
drop table expenses;
drop table user_limit;