-- Historical news, approximate manually placed coordinates and illustrative neutral symbols.
-- Times use publication day at noon UTC as a demo convention, not actual incident times.
INSERT INTO map_layer(id,name,color,kind,sample,sort_order) VALUES
('10000000-0000-0000-0000-000000000002','Transport & streets','#e8b86a','pins',true,1);
INSERT INTO map_layer(id,name,color,kind,geometry,sample,sort_order) VALUES
('10000000-0000-0000-0000-000000000003','City centre study area','#63a8d3','area',
'{"type":"Polygon","coordinates":[[[24.731,59.429],[24.775,59.429],[24.781,59.447],[24.748,59.45],[24.731,59.429]]]}',true,2);
INSERT INTO observation(id,layer_id,title,description,latitude,longitude,occurred_at,sidc,source_url,sample,approximate) VALUES
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
'Harbor tramway roadworks','ERR reported continuing tramway construction and street closures near Laikmaa. Historical sample; location and time are approximate.',59.4374,24.7589,'2024-08-19T12:00:00Z','SNGP-----------','https://news.err.ee/1609428490/roadwork-overview-what-to-expect-in-tallinn-by-september-1',true,true),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',
'Tondi crossing reconstruction','ERR reported ongoing work to rebuild the Tondi railway crossing. Historical sample; location and time are approximate.',59.4075,24.7296,'2024-08-19T12:00:00Z','SNGP-----------','https://news.err.ee/1609428490/roadwork-overview-what-to-expect-in-tallinn-by-september-1',true,true),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002',
'Vana-Kalamaja reopening announced','ERR reported a planned September 3 reopening of Vana-Kalamaja after reconstruction. Historical sample; location and time are approximate.',59.4446,24.7368,'2023-08-24T12:00:00Z','SNGP-----------','https://news.err.ee/1609074554/tallinn-trams-2-4-to-resume-vana-kalamaja-tanav-reopen-from-september',true,true);
