-- Whole-business P&L (CE_TOTALE) monthly figures, read verbatim from the Master CE_TOTALE tab.
-- Sheet-sourced reference values (NOT recomputed from transactions): the replica only holds
-- Amimi-brand transactions, so the total-business view (which includes January's inherited activity)
-- is carried as faithful sheet values to power the "Totale" toggle and show January.
create table if not exists ce_totale_monthly (
  year int not null default 2026,
  month int not null,
  online_netto numeric not null default 0,
  offline_netto numeric not null default 0,
  lordo numeric not null default 0,
  netto numeric not null default 0,
  mc1 numeric not null default 0,
  mc2 numeric not null default 0,
  primary key (year, month)
);

insert into ce_totale_monthly (year,month,online_netto,offline_netto,lordo,netto,mc1,mc2) values
 (2026,1, 4018,          430,          5426,   4448,          802,          -2069.81),
 (2026,2, 3014.262295,   817.2131148,  4674.4, 3831.47541,    1636.67018,   -267.3298202),
 (2026,3, 7070.081967,   1972.95082,   11032.5,9043.032787,   5509.276277,  -450.0937231),
 (2026,4, 6528.442623,   3592.622951,  12347.7,10121.06557,   6324.051354,  -550.1886462),
 (2026,5, 9951.721311,   2334.836066,  14989.6,12286.55738,   7649.770357,  1461.690357),
 (2026,6, 10625.98361,   4439.344262,  18599.7,15245.65574,   8373.313318,  8373.313318)
on conflict (year,month) do update set
  online_netto=excluded.online_netto, offline_netto=excluded.offline_netto,
  lordo=excluded.lordo, netto=excluded.netto, mc1=excluded.mc1, mc2=excluded.mc2;

grant select on ce_totale_monthly to anon, authenticated;
