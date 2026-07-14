/* ================= DATA ================= */
/* Player rows: name|club|price($k)|positions|avg|gp|high|low|own%|last3avg  (real season data) */
const RAW=`Payne Haas|0|731|2|57.9|8|79|24|21|52.3~Terrell May|14|879|2|68.8|11|86|51|32|72.3~Joe Roddy|9|258|3|22|3|24|21|3|22~Nathan Cleary|7|969|4|75.7|12|95|46|48|79.3~Herbie Farnworth|3|841|5|67.9|11|109|40|41|65.3~Hudson Young|9|747|3|58.8|10|77|40|5|58~Jayden Campbell|15|695|4|60.4|10|89|33|11|59.3~Isaah Yeo|7|712|2|56.8|12|71|42|13|48.3~Erin Clark|16|708|2|53.8|12|70|34|11|59.7~Joseph Tapine|9|710|2|53|13|76|32|13|63.7~Latrell Mitchell|8|906|6.5|69.9|9|104|38|10|68.7~Dylan Lucas|6|733|3|58.9|11|90|38|2|72.7~Jacob Preston|1|599|3|48.9|11|80|4|3|36.7~Fletcher Sharpe|6|497|4|37.8|11|66|19|3|48.7~Isaiya Katoa|3|635|4|49.8|12|67|34|15|56.3~Keaon Koloamatangi|8|508|2|42.7|13|56|28|4|43.7~Nicholas Hynes|12|741|4|61.1|10|84|31|6|60.7~Trai Fuller|3|458|6|30|3|45|3|2|30~Kai Pearce-Paul|14|702|3|59|11|84|30|14|58.3~Toby Couchman|4|799|2.3|59.8|12|83|33|20|64.3~Jamal Fogarty|11|695|4|54.6|11|78|33|4|49.7~Blayke Brailey|12|695|1|56.7|10|76|44|5|46~James Tedesco|10|638|6|52.3|12|97|19|17|28.7~Patrick Carrigan|0|708|2|55.4|10|73|27|4|45.7~Matty Nicholson|9|680|3|0|0|0|0|0|0~Beau Fermor|15|614|3|48.1|12|69|31|1|44.7~Lindsay Smith|7|488|2|37.6|13|48|24|1|47.3~Tino Fa'asuamaleaui|15|600|2|43.1|11|57|30|4|51.7~Daly Cherry-Evans|10|567|4|46.8|12|64|25|1|42.3~Luke Metcalf|16|581|4|24.5|2|29|20|1|24.5~Corey Horsburgh|9|658|2|50.2|13|69|30|3|54~Jacob Kiraz|1|648|5.6|51|9|85|17|22|80~Addin Fonua-Blake|12|619|2|48.7|12|68|37|5|53~Reece Walsh|0|554|6|47.2|10|82|21|19|45.3~Zac Hosking|9|624|3|46.3|11|63|32|2|61.7~Cameron McInnes|12|518|2|36.8|5|65|20|1|44~Harry Grant|13|767|1|58.2|13|88|39|33|62.7~Valentine Holmes|4|457|5|36.9|13|65|15|3|44~Max King|1|628|2|50.2|9|66|37|1|58.3~Adam Reynolds|0|504|4|40.4|11|65|8|2|44~Cameron Munster|13|652|4|50.4|13|81|35|5|65.3~Angus Crichton|10|519|3|41.4|12|57|26|4|39.3~Naufahu Whyte|10|564|2|43.8|12|75|25|5|51.7~David Fale|4|265|5|27|2|33|21|5|27~Scott Drinkwater|2|562|6|47.1|14|79|21|8|42~Jack Williams|5|618|2.3|50.4|13|60|36|5|52~Jaydn Su'A|4|579|3|46.8|8|77|11|1|28.7~Damien Cook|4|716|1|56.3|13|91|28|5|56~Viliame Kikau|1|547|3|41.9|7|74|8|1|37.3~Tom Dearden|2|733|4|56.3|10|75|29|3|66~KL Iro|12|621|5|45.4|11|74|28|5|41~John Bateman|2|625|3|0|0|0|0|0|0~Jackson Ford|16|809|2|64.8|12|90|44|21|49.3~Connor Watson|10|470|1.2|36.8|12|76|11|3|46.3~Jeremy Marshall-King|3|521|1|36.8|4|39|34|0|37.3~Trent Loiero|13|567|2|47.6|11|76|33|1|52~Hamiso Tabuai-Fidow|3|548|6|47.5|11|75|29|6|43~Dylan Egan|4|651|3|56.2|5|68|36|1|63.3~Daniel Saifiti|3|615|2|0|0|0|0|0|0~Jack De Belin|5|372|2|29.7|10|49|22|0|24.7~Dylan Edwards|7|692|6|54.5|13|92|22|8|56.3~Mark Nawaqanitawase|10|551|6|44.9|9|76|2|3|43~Jordan Riki|0|661|3|52.7|12|78|41|3|45.7~Euan Aitken|8|616|3.5|48.9|9|72|28|7|46~Taylan May|14|572|5|42.3|6|104|5|2|54~Leo Thompson|1|654|2|52.4|8|72|26|2|61.7~Haumole Olakau'atu|11|804|3|62|11|88|41|6|69~Isaiah Papali'i|7|664|2.3|52.4|13|76|36|9|61~Sam Verrills|15|397|1|30.1|8|49|9|0|16~Moala Graham-Taufa|8|230|5|9|2|11|7|3|9~J'maine Hopgood|5|560|2|29.5|2|49|10|1|29.5~Junior Paulo|5|469|2|36.3|11|42|26|1|38.7~Trey Mooney|6|576|2|47.7|12|80|26|16|42.3~Mitchell Moses|5|606|4|47|11|68|27|7|45.3~Mitchell Barnett|16|498|2|37|5|47|28|1|39.7~Tanah Boyd|16|638|4|56|10|86|5|3|34.3~Wayde Egan|16|439|1|36.7|12|64|11|3|44.3~Bradman Best|6|539|5|43.9|7|75|16|2|49.3~Apisai Koroisau|14|579|1|46.1|9|63|31|3|40.7~Jahrome Hughes|13|670|4|53.9|13|73|32|7|51.3~James Fisher-Harris|16|593|2|49|12|67|33|5|49.3~Reece Robson|10|600|1|48.4|10|66|34|3|42~Stefano Utoikamanu|13|675|2|54.5|14|76|43|11|62.7~Jai Arrow|8|573|2.3|0|0|0|0|0|0~Kotoni Staggs|0|506|5|42.2|11|65|25|6|38~Tom Starling|9|506|1|38.6|13|57|22|2|39.7~Alex Twal|14|869|2|70.3|10|93|50|8|73~Braidon Burns|2|574|6|46.6|10|69|27|0|54~Siua Wong|10|671|3|54.1|12|76|40|3|47.7~Sam Walker|10|592|4|46.3|12|81|9|3|46~Reuben Cotter|2|563|2|43|11|60|22|3|42.3~Josh Curran|1|343|2.3|23|8|57|2|2|28.7~Moeaki Fotuaika|15|417|2|33|12|42|22|0|36~Jake Clifford|2|634|4|52|14|89|31|3|42.3~Gehamat Shibasaki|0|281|5|21.5|11|39|7|3|26.3~Max Plath|3|624|2.1|47.2|10|62|27|5|45.7~Kurt Donoghoe|3|420|1.2|31.6|5|67|6|1|41.3~Roger Tuivasa-Sheck|16|436|6|31.2|10|51|2|1|28.3~Adam Doueihi|14|739|4|60.8|8|93|22|4|57.3~Briton Nikora|12|391|3|34.6|10|69|14|3|43.7~Kitione Kautoga|5|545|3|43.6|8|63|31|0|40~Matthew Timoko|9|475|5|37|8|61|21|2|34~Robert Toia|10|563|5|46.1|11|64|28|4|49.7~Reuben Garrick|11|537|5.6|41.5|13|72|23|5|43~Jaimin Jolliffe|15|551|2|0|0|0|0|0|0~Tallis Duncan|8|641|3|52|13|91|23|7|56.3~Matt Burton|1|651|4|53.5|12|83|35|3|61~Shawn Blore|13|392|3|26.9|7|49|14|0|26.7~AJ Brimson|15|386|4.6|29.8|11|49|10|2|28~Peter Mamouzelos|8|376|1|30|8|41|7|0|24.3~Teig Wilton|12|558|3|42.4|10|72|16|1|48~Lachlan Galvin|1|696|4|56.2|13|74|30|7|64~Kyle Flanagan|4|341|4|26.6|10|51|14|0|24.7~Brian To'o|7|534|6|39.3|12|86|8|7|50.3~Dane Gagai|6|469|5|40.8|13|86|12|2|51~Nat Butcher|10|510|2.3|41.4|12|63|27|1|35.7~Kalyn Ponga|6|710|6|61.4|7|85|36|18|54.7~Nick Meaney|13|388|5.6|28.7|12|44|11|3|29.7~Tevita Naufahu|3|401|6|28|2|55|1|0|28~Tom Trbojevic|11|612|6|46.8|6|67|6|1|34~Greg Marzhew|6|653|6|45|12|116|17|3|42.7~Jamie Humphreys|8|437|4|36.8|8|53|19|0|39.3~Stephen Crichton|1|481|5|38.7|10|53|19|6|40.3~Harry Hayes|1|434|2|34.9|10|48|16|1|33~Tom Rodwell|10|250|6|0|0|0|0|0|0~Mitch Kenny|7|429|1|30.2|6|50|12|1|27~Alex Seyfarth|14|332|2.3|22.8|11|51|10|1|40.3~Samuela Fainu|14|643|3|54.5|8|76|42|1|49.3~Paul Alamoti|7|515|5.6|39.5|13|75|21|5|55.7~Jacob Halangahu|4|241|3|11.3|4|22|4|0|7.7~Tolutau Koula|11|539|5|46.2|11|73|16|7|48~Ronaldo Mulitalo|12|501|6|43.7|3|69|20|1|43.7~Phillip Sami|15|466|5.6|36.3|12|62|16|1|43.3~Tom Gilbert|3|473|2|40.4|12|61|26|2|39.7~Liam Henry|7|536|2|46.5|4|54|33|0|44~Luke Garner|7|394|3|33|12|50|16|1|31.7~Jacob Liddle|4|413|1|28.8|5|49|17|0|29~Jake Simpkin|11|382|1|32.8|13|51|18|1|33.3~Cody Hopwood|6|231|2|16.5|4|27|11|2|17~Murray Taulagi|2|506|6|41|9|60|16|1|46.3~Ethan Strange|9|573|4|44.8|11|68|11|4|50.3~Christian Tuipulotu|4|307|6|25.2|9|45|3|0|29~Brian Kelly|5|489|5.6|39.7|11|65|20|1|37~Josh King|13|562|2|42.5|14|68|26|1|44~Josiah Karapani|0|323|6|29.2|13|51|7|1|45.7~Ben Trbojevic|11|594|3|50.8|13|79|27|1|59.7~Thomas Jenkins|7|566|6|52.8|13|89|19|6|63.7~Clinton Gutherson|4|338|6|26|10|44|7|1|27.3~Moses Leota|7|472|2|36.8|13|60|24|3|36~Chanel Harris-Tavita|16|451|4|35|9|47|0|2|32~Xavier Coates|13|501|6|0|0|0|0|1|0~Connor Tracey|1|343|6|32.6|11|66|12|1|31.3~Mat Croker|6|463|2|39.2|13|55|26|1|38~Mawene Hiroti|12|396|5.6|29.7|6|40|22|0|31.7~Jye Gray|8|440|6|37|9|68|6|5|32.3~Victor Radley|10|375|2.3|28.9|7|42|18|1|25.7~Ethan Bullemor|11|369|2|29.9|10|48|10|0|21.3~Jahream Bula|14|510|6|41|9|67|22|2|32.7~Phoenix Crossland|6|461|1|40.1|13|57|5|3|28.7~Leka Halasima|16|384|3|32.7|12|69|12|7|27.3~Isaiah Iongi|5|520|6|44.3|6|67|21|5|39.3~Lehi Hopoate|11|486|6|38.8|12|63|11|1|33~Kodi Nikorima|3|428|4|33.4|9|58|20|1|41.7~Scott Sorensen|7|373|2.3|28.8|13|42|14|2|35.3~Kelma Tuilagi|5|517|3|45.3|10|73|29|1|37.3~Liam Martin|7|412|3|33.2|6|54|20|2|34.3~Josh Addo-Carr|5|429|6|33.4|12|53|13|2|33.3~Starford To'a|14|397|5|19|3|28|10|0|19~Reed Mahoney|2|527|1|39.5|13|71|2|9|39~Chris Randall|15|436|1.2|35.5|11|57|15|1|22.3~Morgan Smithies|9|428|2|35.6|13|53|22|1|28.7~Daniel Tupou|10|431|6|32.2|10|45|3|1|26.7~Jarome Luai|14|443|4|37.1|9|66|12|3|29.7~Dylan Brown|6|635|4|52.9|9|96|37|15|51.7~Taniela Paseka|11|562|2|44.7|13|60|34|2|46.7~Kulikefu Finefeuiaki|3|630|3|54.5|12|76|36|3|46.7~Charnze Nicoll-Klokstad|16|470|6|36|5|43|28|1|35~Jamayne Isaako|3|616|6|49.4|12|104|24|8|36.3~Jake Averillo|3|626|5|50|7|67|22|1|45~Casey McLean|7|527|5|42.3|12|71|21|13|43.3~Tyson Frizell|6|377|2|32.7|11|54|22|1|28~Jesse Ramien|12|431|5|35.4|7|63|15|1|27~Josh Papalii|9|350|2|20.8|5|44|9|1|16~Mathew Feagai|4|318|6|22|8|54|2|0|32.3~Lachlan Hubner|8|402|2|31.1|12|48|12|0|40.3~Ezra Mam|0|357|4|31.6|14|61|15|2|27.7~Griffin Neame|2|306|2|24.2|14|34|15|0|26~Ryley Smith|5|315|1|24.9|9|42|3|1|15~Heamasi Makasini|14|283|5.6|24.9|8|37|11|20|15.3~Sione Katoa|12|502|6|39.8|6|57|17|1|34~Bailey Simonsson|5|458|6|36.4|5|46|23|0|43.7~Xavier Willison|0|650|2.3|50|14|83|18|25|71~Jaxon Purdue|2|395|4.5|36.9|14|63|14|9|29.3~Savelio Tamale|9|402|6|34|12|57|4|1|24~Kaeo Weekes|9|543|6|43.9|13|58|24|9|47~Sualauvi Faalogo|13|614|6|52.6|14|84|26|43|62~Izack Tago|7|456|5|38.1|7|47|22|1|40.3~Alex Johnston|8|599|6|48.8|12|75|24|2|41.3~Ben Hunt|0|341|4|27.6|10|43|16|1|28.3~Lindsay Collins|10|318|2|28|11|44|12|1|27.7~Tevita Tatola|8|362|2|32.9|13|45|22|0|34.3~David Fifita|8|517|3|42.9|7|53|27|8|47.3~Coen Hess|2|472|2|36.3|14|56|20|1|43.7~Siosiua Taukeiaho|11|380|2|28|5|46|7|0|38~Moses Suli|4|383|5|32.1|9|51|16|0|24.7~Dean Hawkins|5|462|4|0|0|0|0|0|0~Kobe Hetherington|11|379|2|32.2|12|63|5|1|34.3~Sam McIntyre|2|398|2.3|32.3|12|55|9|1|36.3~Enari Tuala|1|523|6.5|44.1|10|59|26|2|50~Thomas Hazelton|12|358|2|30.3|12|44|20|0|27~Jaxson Paulo|2|350|6|0|0|0|0|0|0~Selwyn Cobbo|3|541|6|41.7|11|68|15|4|57.7~Daine Laurie|9|444|6|36.7|6|54|23|1|34.7~Jeremiah Nanai|2|428|3|28|2|30|26|0|28~Samuel Healey|16|253|1|18.4|12|35|6|3|19.3~Jack Howarth|13|426|5|35.1|12|51|10|2|40.7~Jacob Saifiti|6|461|2|40.6|13|67|19|1|40.3~Jojo Fifita|15|502|5.6|40|11|65|18|1|35~Connelly Lemuelu|3|587|3|50.1|12|68|29|3|49.7~Dylan Walker|5|301|2|28.9|13|46|8|1|25.3~Harrison Edwards|5|358|2|19.7|3|27|11|0|19.7~Jayden Brailey|9|314|1|21|12|44|6|3|31.7~Lyhkan King-Togia|4|356|4|19.7|3|32|0|0|19.7~Jake Trbojevic|11|466|2|35.7|13|46|21|1|45~Lachlan Ilias|15|385|4|29.5|8|40|8|0|32.7~Hamish Stewart|4|672|2.3|53.5|13|71|37|24|59.7~Campbell Graham|8|464|5.6|36.4|10|51|16|2|36~Emre Guler|4|410|2|34.6|12|52|16|0|28.3~Egan Butcher|10|342|3|26.2|6|42|2|0|19~Thomas Cant|6|286|3|16|5|21|11|1|15.7~Dominic Young|6|522|6|42.7|13|75|8|3|41~Jason Taumalolo|2|512|2|40.8|13|50|33|2|39~Taine Tuaupiki|16|529|6|43.8|10|64|29|2|46.3~Sandon Smith|6|478|4|38.3|11|58|17|0|36.3~Billy Burns|12|482|3|38.8|12|65|16|1|48~Luke Brooks|11|519|4|40.2|13|53|24|1|42.3~Oregon Kaufusi|12|347|2|26|9|41|15|0|20.7~Blaize Talagi|7|547|4|40.8|13|69|10|3|37.3~Demitric Vaimauga|16|381|3|29.5|11|47|16|1|24~Luciano Leilua|4|560|3|46.1|10|77|21|1|27.3~Kyle McCarthy|6|350|6|0|0|0|0|0|0~Klese Haas|15|402|2.3|32|11|46|23|1|35.7~Kurt Capewell|16|459|3.5|37.2|5|48|25|4|32.7~Max Feagai|15|384|5|26|3|33|21|0|26~Will Warbrick|13|328|6|32.7|14|76|12|3|25~Bronson Xerri|1|404|5|33.2|10|60|14|2|37~Samuel Hughes|1|372|2|26.5|8|45|8|0|32.7~Francis Molo|3|323|2|25.8|8|34|16|0|23~Corey Waddell|11|379|2.3|26.7|6|42|5|0|27~Blake Steep|10|375|2.3|22.3|3|26|18|0|22.3~Sebastian Kris|9|437|5|32.8|11|57|20|1|43.3~William Kennedy|12|452|6|37.3|12|68|21|1|37~James Schiller|6|402|6|19|1|19|19|0|19~Deine Mariner|0|389|6|28|9|45|-3|1|27.7~Delouise Hoeter|0|250|5|0|0|0|0|0|0~Jack Cogger|7|246|4|16.5|10|58|2|3|35~Grant Anderson|0|360|6|28.5|4|42|14|0|32~Braydon Trindall|12|615|4|48.9|12|81|17|4|60.7~Will Penisini|5|469|5|37.6|5|54|18|1|33~Viliami Vailea|2|416|5|0|0|0|0|0|0~Charlie Guymer|5|351|3|27.1|8|45|-1|0|25.7~Sitili Tupouniua|1|616|2.3|46.1|13|71|26|7|60.7~Jermaine McEwen|6|502|3|41.2|13|58|15|4|45.7~Aublix Tawha|0|272|2|13.3|6|21|0|1|11.7~Billy Smith|10|428|5|37.8|4|50|13|1|35.7~Cory Paix|0|456|1|35.8|13|50|18|1|33.7~Corey Jensen|0|474|2|37.7|7|54|12|0|35.3~Alofiana Khan-Pereira|16|435|6|36.6|7|56|-7|3|28.3~Ray Stone|3|362|2|27.4|11|39|11|0|26.3~Jack Bostock|3|543|6.5|50.8|5|63|39|20|48.7~Sean Keppie|8|399|2|29.3|11|51|8|0|26.7~Spencer Leniu|10|292|2|22.5|8|43|1|3|28.7~Tyson Gamble|6|418|4|47|1|47|47|0|47~Jack Wighton|8|317|4.5|24.8|8|37|4|2|16~Sunia Turuva|14|369|6.5|35|12|80|4|2|22.3~Tyran Wishart|13|249|4|20.9|9|42|7|2|17.3~Fonua Pole|14|425|2|33.2|12|42|17|1|36.3~Siulagi Tuimalatu-Brown|13|230|6|3|3|9|-1|1|3~Salesi Foketi|10|230|2.3|15.3|10|33|5|3|20~Adam Pompey|16|286|5|23|7|40|7|2|25.3~Kurt Mann|1|333|2|27.2|11|41|10|1|29~Billy Walters|0|388|1.4|0|0|0|0|0|0~Marcelo Montoya|1|311|6|27.6|8|44|7|1|22~Jeral Skelton|14|390|6|32.3|6|61|14|1|30.3~Robert Derby|2|379|6|32|1|32|32|0|32~Ethan Sanders|9|551|4|44|13|58|15|24|37~Thomas Fletcher|8|230|3|3|2|6|0|1|3~Josh Kerr|4|258|3|21.9|11|29|10|1|16.7~Sean O'Sullivan|1|253|4|12.8|4|23|2|0|12~Matthew Lodge|2|324|2|25.3|12|37|16|0|32~Brodie Jones|6|377|3|0|0|0|0|0|0~Latu Fainu|14|246|4|17.4|8|37|8|0|25.7~Bailey Hayward|1|395|1.2|34.5|13|54|22|9|32~Simi Sasagi|9|669|3.5|52.4|9|73|6|4|49.3~Clayton Faulalo|11|531|6|41.8|9|63|16|2|46~Ryan Matterson|5|300|2|0|0|0|0|0|0~Luca Moretti|5|367|2|29.1|10|67|17|0|23~Oryn Keeley|3|363|3|28|4|34|21|0|26~Zac Laybutt|2|348|5.6|26.4|10|49|5|1|34.7~Samuel Stonestreet|12|346|6|29.2|12|38|12|1|28.3~Ronald Volkman|5|473|4|41.3|8|62|28|3|47.3~Tyrone Munro|8|369|6|0|0|0|0|0|0~Ata Mariota|9|438|2|31.7|13|52|14|1|41~Bronson Garlick|8|281|1|19|11|35|0|1|14~Alec MacDonald|13|336|2|26.5|10|37|0|0|26~Marata Niukore|16|341|2.3|25.8|5|44|11|1|21.7~Mavrik Geyer|14|276|3|20|2|33|7|0|20~Sean Russell|5|294|5.6|26.8|11|49|14|3|22.3~Ali Leiataua|16|404|5|33.1|9|50|14|2|28.7~Lipoi Hopoi|1|230|2|11.3|4|17|7|0|12.7~Davvy Moale|13|248|2|17.6|8|22|7|0|19.7~Jaeman Salmon|1|531|2|40.6|13|54|23|2|43.3~Jack Cole|7|300|4|0|0|0|0|0|0~Tyrell Sloan|4|301|6|23.9|7|51|7|1|21~Sione Fainu|14|380|2|30.5|11|42|19|2|31.3~Thomas Mikaele|2|535|2|41.5|12|62|17|3|43.3~Jesse Arthars|0|337|6|28.9|9|53|6|3|31~Felise Kaufusi|3|230|2|20.1|11|30|9|3|15.7~Nathan Brown|11|318|2|23.4|8|39|8|0|30.7~Loko Pasifiki Tonga|4|451|2|38.1|7|51|22|1|44.3~Cody Walker|8|424|4|36.2|13|54|20|4|41.7~Zach Dockar-Clay|11|340|1|23|1|23|23|0|23~Jason Saab|11|366|6|25.9|12|73|4|4|29.3~Jesse Colquhoun|12|533|2|43.9|12|65|33|9|43.3~Toby Rudolf|12|415|2|31.5|12|47|17|1|40.7~Siosifa Talakai|12|365|3.5|26.6|11|70|7|4|22.3~Sione Finau|9|300|6|0|0|0|0|0|0~Caleb Navale|11|342|2|0|0|0|0|0|0~Josiah Pahulu|13|300|2|0|0|0|0|0|0~Tanner Stowers-Smith|16|390|2|33|7|51|17|1|36.7~Blake Lawrie|4|322|2|27.1|8|51|16|1|21~Brad Schneider|3|331|4|29.1|7|49|2|1|37~Keano Kini|15|568|6|46.3|12|90|28|7|40.7~Jacob Laban|16|349|3|29.9|11|65|10|3|43~Jack Gosiewski|0|445|3|34.2|9|58|5|1|36~Braden Hamlin-Uele|12|297|2|14|2|15|13|0|14~Jake Tago|5|250|6|0|0|0|0|0|0~Harrison Graham|6|377|1|32.1|9|47|20|1|36~Benaiah Ioelu|10|342|1|28.5|2|36|21|1|28.5~Luron Patea|7|326|2|0|0|0|0|0|0~Hame Sele|4|358|2|30.8|5|45|23|1|30.3~Matthew Eisenhuth|7|325|2|0|0|0|0|0|0~Jack Bird|14|322|3|0|0|0|0|0|0~Brandon Smith|8|327|1.2|27.8|5|49|12|8|21~Tukimihia Simpkins|15|257|2|20|2|29|11|1|20~Joash Papalii|5|418|6|28.9|11|52|1|12|34.3~Edward Kosi|8|230|6|13.5|4|30|4|0|16~Xavier Savage|9|364|6|31.6|8|50|10|2|22.7~Isaiah Tass|8|313|5.6|0|0|0|0|0|0~Brendan Piakura|0|334|3|29.7|9|63|19|3|42.7~Jordan Samrani|5|369|5|30.8|6|64|13|1|27.3~Joe Chan|13|310|3|35.2|13|83|4|5|15.7~Dallin Watene-Zelezniak|16|527|6|38.9|12|79|15|6|50.3~Tristan Hope|14|348|1|30.4|5|57|9|1|27.3~Nathan Lawson|4|250|6|0|0|0|0|0|0~Thomas Duffy|0|348|4|30.8|5|70|5|2|18~Jed Stuart|9|230|6|17.3|8|29|1|2|15.7~Matt Doorey|5|253|3|17.3|4|23|12|1|19~Blake Wilson|11|230|6|14|2|21|7|1|14~Sam Tuivaiti|5|291|2|24.4|7|35|11|1|20~Josh Patston|15|259|3|23|3|27|17|4|23~Luke Laulilii|14|439|6|39|8|58|21|2|45.3~Taylor Losalu|10|250|2|0|0|0|0|0|0~Ativalu Lisati|13|614|3|56.4|8|79|35|29|39.7~Luke Sommerton|15|230|1|13.3|3|15|12|1|13.3~Kurtis Morrin|15|383|2|29.4|12|52|19|2|36~Kai O'Donnell|2|321|3|27|5|36|17|1|27.3~Jayden Sullivan|8|230|4|12.7|7|24|3|3|13.3~Tony Sukkar|14|299|3|45|1|45|45|1|45~Rocco Berry|16|272|5|0|0|0|0|0|0~Tony Francis|15|269|6|0|0|0|0|0|0~Jake Turpin|1|262|1|23|3|35|4|1|23~Manaia Waitere|13|288|5|26.6|7|55|2|1|28.7~Jaiyden Hunt|0|243|2|17.7|3|20|13|1|17.7~Heath Mason|14|272|6|27.5|2|32|23|0|27.5~Noah Martin|9|575|3|51.5|8|80|23|5|35~Marion Seve|13|250|5|0|0|0|0|0|0~Jaylan De Groot|15|244|6|21|2|27|15|1|21~Freddy Lussick|7|485|1|38.7|10|59|10|6|46.3~Trent Toelau|13|236|4|18|3|20|16|0|18~Jesse McLean|7|250|6|0|0|0|0|1|0~Liam Le Blanc|8|255|2|25.5|2|29|22|0|25.5~Tuku Hau Tapuha|12|250|2|0|0|0|0|0|0~Owen Pattie|9|230|1|13.8|5|26|5|2|14.7~Jack Hetherington|13|230|2|17|5|21|12|2|15.7~Lazarus Vaalepu|13|250|2|0|0|0|0|0|0~Moses Leo|13|428|6.5|36.2|9|68|11|8|49.3~Te Maire Martin|16|448|4|64.3|3|72|58|23|64.3~Karl Lawton|2|250|1.3|0|0|0|0|0|0~Royce Hunt|14|237|2|20.4|12|44|9|5|16~Tallyn Da Silva|5|418|1|29.2|13|61|10|6|31~Elijah Salesa-Leaumoana|6|238|3|11|1|11|11|0|11~Benjamin Te Kura|0|250|2|0|0|0|0|1|0~Cameron Murray|8|625|2|50.7|11|60|35|4|59.3~Toni Mataele|5|279|3|23.2|5|34|14|1|25.7~Jack Todd|1|250|2|0|0|0|0|0|0~Jonah Pezet|5|343|4|23.6|5|35|14|2|23~Matthew Arthur|6|250|1|0|0|0|0|0|0~Junior Tupou|10|250|6|0|0|0|0|0|0~Allan Fitzgibbon|15|250|6|0|0|0|0|0|0~Hohepa Puru|12|308|2|30.5|4|47|14|1|36~Michael Asomua|9|250|6|0|0|0|0|0|0~Brock Gray|15|250|2|0|0|0|0|0|0~Daniel Suluka-Fifita|1|250|2|0|0|0|0|0|0~Daniel Atkinson|4|517|4|42.3|12|59|25|2|51~Aaron Schoupp|11|250|5|0|0|0|0|0|0~Kaiden Lahrs|2|243|2|14|1|14|14|0|14~Arama Hau|15|419|3|41.7|12|87|15|5|31.3~Kit Laulilii|14|250|2|0|0|0|0|0|0~Chevy Stewart|9|237|6|9|1|9|9|1|9~De La Salle Va'a|10|250|2|0|0|0|0|0|0~Joey Walsh|11|324|4|48.5|2|54|43|3|48.5~Peter Hola|6|232|2|4|1|4|4|0|4~Sione Fonua|7|250|6|0|0|0|0|0|0~Jaxen Edgar|7|250|6|0|0|0|0|0|0~Adam Elliott|8|449|2|27.3|3|32|19|0|27.3~Jayden Berrell|12|249|1|19.5|2|24|15|1|19.5~Matthew Dufty|8|414|6|39|6|66|1|3|22.7~Tui Kamikamica|13|282|2|22.8|4|30|14|2|21.7~Bunty Afoa|14|277|2|21|1|21|21|0|21~Soni Luke|2|334|1|23.8|8|72|4|1|18~Fetalaiga Pauga|10|352|5.6|26|4|41|13|0|21~Patrick Herbert|14|323|5|31.4|5|53|1|2|24.7~Pasami Saulo|6|295|2|24.2|13|39|15|3|21.7~Kalani Going|7|230|2|12.7|3|15|9|4|12.7~Brandon Wakeham|11|329|4.1|24.4|11|60|11|1|23.7~Thomas Flegler|3|357|2|30.3|10|46|17|1|27.3~Ben Talty|0|434|2|32.6|14|64|13|2|31.7~Josh Rogers|0|306|4|30.8|4|45|22|1|32~Tommy Talau|10|286|6.5|0|0|0|0|1|0~Bayleigh Bentley-Hape|8|265|6|36|1|36|36|0|36~Jensen Taumoepeau|15|262|6|24|4|36|18|2|25~Jock Madden|14|507|4|43.8|9|68|9|3|44~Morgan Knowles|3|418|2|34.1|11|60|7|1|38.3~Hayze Perham|0|243|6|18.7|3|30|11|1|18.7~Brent Woolf|3|230|1|15|1|15|15|2|15~Preston Riki|0|330|3.2|33|6|42|12|2|31.7~Wiremu Greig|2|230|2|10|3|13|8|0|10~Cody Ramsey|10|287|6|26|4|49|7|3|32.3~Niwhai Puru|12|290|4|42|2|42|42|7|42~Jackson Shereb|11|292|3|35|3|56|12|2|35~Kade Dykes|1|250|6|0|0|0|0|0|0~Solome Saukuru|14|230|3|0|0|0|0|3|0~Hugo Savala|10|463|4.5|35.6|9|47|9|1|42.3~Joseph O'Neill|1|230|4|0|0|0|0|2|0~Asu Kepaoa|6|250|5|0|0|0|0|0|0~Tom Ale|7|250|2|0|0|0|0|0|0~Luke Gale|0|230|3|0|0|0|0|0|0~Fletcher Baker|1|260|2|0|0|0|0|0|0~Latrell Siegwalt|8|346|6|46|4|55|35|10|43~Myles Martin|9|230|2|0|0|0|0|3|0~Setu Tu|4|402|6|35.4|11|53|16|18|29.7~Heilum Luki|2|672|3|56.3|14|69|33|35|61.7~Chris Vea'ila|12|250|5|0|0|0|0|0|0~Lachlan Crouch|6|230|2|0|0|0|0|1|0~Liam Sutton|2|375|4|43|4|52|32|6|46.7~Charlie Murray|14|256|2|28|1|28|28|1|28~Tom Chester|2|591|6.5|49.5|13|80|23|45|51.7~Ronald Philitoga|2|230|6|0|0|0|0|0|0~John Radel|8|230|2|36|1|36|36|0|36~Paul Bryan|11|230|2|9|2|15|3|1|9~Talanoa Penitani|8|272|6|63|1|63|63|0|63~James Walsh|3|230|3|0|0|0|0|3|0~Ashton Ward|8|432|4|37.8|6|55|14|1|38.3~Liam Ison|12|250|6|0|0|0|0|0|0~Billy Scott|7|230|1|9|1|9|9|3|9~Luke Hanson|16|252|4|39|1|39|39|2|39~Zyon Maiu'u|1|250|3|0|0|0|0|0|0~Jett Liu|15|230|2|0|0|0|0|1|0~Saxon Pryke|5|336|2|31|5|41|23|2|25~Vena Patuki-Case|9|230|2|0|0|0|0|1|0~Ethan Roberts|14|240|3|29|1|29|29|0|29~Jake Elliott|10|230|2|0|0|0|0|0|0~Araz Nanva|5|257|5|29|2|31|27|1|29~Josh Feledy|11|287|5|23.5|4|39|9|0|28.3~William Craig|14|230|6|0|0|0|0|1|0~Wilson De Courcey|6|230|5|5.5|2|11|0|1|5.5~Jett Cleary|16|230|4|0|0|0|0|0|0~Jake Clydsdale|9|230|2|0|0|0|0|1|0~Faaletino Tavana|14|230|6|18.8|5|29|3|1|14.7~Richard Penisini|5|230|6|0|0|0|0|1|0~Keagan Russell-Smith|13|247|4|39|1|39|39|0|39~Preston Conn|13|230|3|5|1|5|5|1|5~Patrick Young|1|230|1|0|0|0|0|1|0~Navren Willett|11|230|6|0|0|0|0|1|0~Adam Christensen|15|230|3|10|1|10|10|0|10~Jonah Glover|8|230|4|0|0|0|0|0|0~Ryan Couchman|4|674|3.2|58.8|9|69|42|36|62.7~Fletcher Hunt|6|311|6|33.1|11|71|0|3|23~Ethan Alaia|9|230|6|0|0|0|0|0|0~Logan Spinks|1|230|3|0|0|0|0|0|0~Billy Phillips|7|324|3|26.1|11|35|10|1|27~Teancum Brown|5|262|2|34|1|34|34|0|34~Morgan Gannon|16|409|3|-1|1|-1|-1|0|-1~Jed Reardon|1|230|3|5.5|2|10|1|0|5.5~Zac Herdegen|2|230|4|0|0|0|0|0|0~Cameron Bukowski|0|230|1|11|1|11|11|0|11~Stanley Huen|13|230|4|4.5|2|7|2|0|4.5~Tyler Peckham-Harris|4|230|6|0|0|0|0|0|0~Reece Foley|10|230|4|0|0|0|0|0|0~Xavier Kerrisk|2|230|1|0|1|0|0|0|0~Mason Kira|2|230|3|0|0|0|0|0|0~Riley Jones|12|250|1|0|0|0|0|0|0~Haizyn Mellars|16|230|6|0|0|0|0|0|0~Jack Underhill|1|298|2|28.5|4|39|17|1|28~Angus Hinchey|13|230|3|5|1|5|5|0|5~Blake Mozer|0|238|1|10|1|10|10|1|10~Va'a Semu|0|240|2|19|6|33|12|2|20~Lewis Symonds|3|230|3|17|1|17|17|1|17~Makaia Tafua|16|230|1|0|0|0|0|0|0~Ethan King|2|235|6|13.5|2|23|4|0|13.5~Oliver Pascoe|15|572|1|44.9|9|77|17|30|58.7~Will Pryce|6|250|4.6|0|0|0|0|0|0~Wil Sullivan|6|230|2|0|0|0|0|0|0~Zane Harrison|15|356|4|38.8|4|45|32|12|36.7~Simione Laiafi|11|230|2|13|4|21|10|3|13.7~Michael Gabrael|12|230|5|0|0|0|0|1|0~Jye Linnane|16|230|4|0|0|0|0|0|0~Mitchell Woods|1|230|4|0|0|0|0|2|0~Lorenzo Talataina|5|230|4|0|0|0|0|0|0~Jordan Uta|9|230|3|14|1|14|14|1|14~Jezaiah Funa-Iuta|5|230|3|0|0|0|0|0|0~Hayden Buchanan|4|257|5|7.7|3|13|-3|0|7.7~Kade Reed|4|230|4|21.5|2|37|6|4|21.5~Jonathan Sua|1|275|6|23.4|5|36|12|5|20~Toby Rodwell|10|230|4|0|0|0|0|0|0~Riley Pollard|12|230|4|0|0|0|0|0|0~Max McCarthy|8|230|6|0|0|0|0|1|0~Finau Latu|1|250|2|0|0|0|0|0|0~Zaidas Muagututia|11|230|1|0|0|0|0|0|0~Coby Black|9|230|4|0|0|0|0|2|0~Mason Barber|2|230|6|0|0|0|0|1|0~Brian Pouniu|3|230|3|16|1|16|16|2|16~Gabriel Satrick|13|230|1|7|1|7|7|2|7~LJ Nonu|3|230|6|0|0|0|0|1|0~Bodhi Sharpley|15|230|2|0|0|0|0|0|0~Kayliss Fatialofa|16|230|3|0|0|0|0|3|0~Hugo Peel|13|230|6|11.5|2|12|11|1|11.5~Francis Manuleleua|6|274|3|23.8|4|46|10|8|28~Alekolasimi Jones|1|236|2|21|2|21|21|1|21~Onitoni Large|11|230|4|0|0|0|0|2|0~Cooper Clarke|13|477|2.3|35.5|14|57|19|7|34~Rex Bassingthwaighte|10|230|6|0|0|0|0|0|0~Jethro Rinakama|1|343|6|40.5|2|47|34|1|40.5~Sialetili Faeamani|15|386|6|31.8|8|53|18|5|39.7~Cooper Bai|15|428|2|33.1|12|55|18|14|30.7~Phillip Coates|0|242|6|15.5|2|31|0|1|15.5~John Fineanganofo|3|230|1.4|0|0|0|0|0|0~Elijah Rasmussen|3|230|2|0|0|0|0|2|0~Sebastian Su'a|3|250|2|0|0|0|0|1|0~Eddie Ieremia-Toeava|16|342|3|23.5|2|39|8|0|23.5~Jason Salalilo|16|230|2|0|0|0|0|0|0~Dayne Jennings|8|230|5|0|1|0|0|0|0~Hugo Hart|11|230|3|0|0|0|0|0|0~Antonio Verhoeven|0|230|5.6|18.3|3|25|7|2|18.3~Apa Twidle|5|260|4|47|1|47|47|1|47`;

const CLUBS=[
 {n:'Broncos',s:'BRI',c1:'#6C1D45',c2:'#FBBF15'},
 {n:'Bulldogs',s:'CBY',c1:'#0055A5',c2:'#FFFFFF'},
 {n:'Cowboys',s:'NQL',c1:'#002B5C',c2:'#FFDD02'},
 {n:'Dolphins',s:'DOL',c1:'#BA0C2F',c2:'#F3D03E'},
 {n:'Dragons',s:'SGI',c1:'#D6001C',c2:'#FFFFFF'},
 {n:'Eels',s:'PAR',c1:'#00529B',c2:'#FFC425'},
 {n:'Knights',s:'NEW',c1:'#013B73',c2:'#EE3124'},
 {n:'Panthers',s:'PEN',c1:'#221F20',c2:'#D5286E'},
 {n:'Rabbitohs',s:'SOU',c1:'#00532C',c2:'#ED1B2F'},
 {n:'Raiders',s:'CAN',c1:'#95C11E',c2:'#FFFFFF'},
 {n:'Roosters',s:'SYD',c1:'#00305E',c2:'#E82C2E'},
 {n:'Sea Eagles',s:'MAN',c1:'#7A0722',c2:'#FFFFFF'},
 {n:'Sharks',s:'CRO',c1:'#00A9E0',c2:'#000000'},
 {n:'Storm',s:'MEL',c1:'#632390',c2:'#FBBF15'},
 {n:'Tigers',s:'WST',c1:'#F68B1F',c2:'#000000'},
 {n:'Titans',s:'GLD',c1:'#ECA72C',c2:'#00498F'},
 {n:'Warriors',s:'WAR',c1:'#101820',c2:'#71CC51'}
];

/* ── Standalone SoO mode: served at /soo ── */
const SOO_STANDALONE=new URLSearchParams(location.search).has('soo');

const POSN={1:'HOK',2:'MID',3:'EDG',4:'HLF',5:'CTR',6:'WFB'};
const POS_IDS=[1,2,3,4,5,6];

const PLAYERS=RAW.split('~').map((row,i)=>{
  const f=row.split('|');
  return {id:i,name:f[0],sq:+f[1],basePrice:+f[2]*1000,pos:f[3].split('.').map(Number),
    avg:+f[4],gp:+f[5],hi:+f[6],lo:+f[7],own:+f[8],l3:+f[9]};
});

/* assign goal kickers: best HLF avg per club */
const KICKERS=new Set();
CLUBS.forEach((c,ci)=>{
  const halves=PLAYERS.filter(p=>p.sq===ci&&p.pos.includes(4)&&p.avg>0).sort((a,b)=>b.avg-a.avg);
  if(halves[0])KICKERS.add(halves[0].id);
});

/* ================= RULES / SETTINGS ================= */
/* Official stat categories from the NRL Fantasy data feed.
   Default point values derived by fitting all 3,600+ real player-games to official scores (99% within +/-1). */
const STAT_KEYS=['T','TS','G','FG','TA','LB','LBA','TCK','TB','MT','OFH','OFG','ER','FTF','MG','KM','KD','PC','SB','SO','FDO','TO','SAI','EFIG'];
const STAT_LABELS={T:'Try',TS:'Try Save',G:'Goal',FG:'Field Goal',TA:'Try Assist',LB:'Line Break',LBA:'Line Break Assist',TCK:'Tackle',TB:'Tackle Bust',MT:'Missed Tackle (neg)',OFH:'Offload',OFG:'OFG (offload ground)',ER:'Error (neg)',FTF:'FTF (40/20 kick)',MG:'Run Metres (per m)',KM:'Kick Metres (per m)',KD:'Kick Defusal',PC:'Penalty Conceded (neg)',SB:'Sin Bin (neg)',SO:'Send Off (neg)',FDO:'Forced Drop Out',TO:'TO (turnover won)',SAI:'SAI (neg)',EFIG:'EFIG'};
const DEFAULT_LAYOUT={HOK:1,MID:3,EDG:2,HLF:2,CTR:2,WFB:3,bench:4,res:4};
const DEFAULT_RULES={T:8,TS:5,G:2,FG:5,TA:5,LB:4,LBA:2,TCK:1,TB:2,MT:-2,OFH:4,OFG:2,ER:-2,FTF:4,MG:0.1,KM:0.03,KD:1,PC:-2,SB:-5,SO:-10,FDO:2,TO:4,SAI:-1,EFIG:2};
const DEFAULT_SETTINGS={
  theme:'lime', themeChosen:false, onboardingVersion:0,
  cap:13000000, tradesPerRound:3, seasonTrades:36, captainMult:2,
  benchScores:true, scoreMode:'official',
  totalRounds:27, rules:{...DEFAULT_RULES}, layout:{...DEFAULT_LAYOUT},
  bonusEvents:false, bonusMetre:5, bonusTackle:5, bonusTryInv:5,
  consistencyBonus:false, consistencyStreak:3, consistencyMult:1.1,
  upsetBonus:false, upsetThreshold:60, upsetBonusPts:10,
  bestBall:false, scoringPeriod:1
};

/* ===== CHIPS ===== */
const CHIP_DEFS={
  injuryWildcard:{id:'injuryWildcard',name:'Injury Wildcard',icon:'🏥',
    desc:'Unlimited free trades for one round. Only unlocks when 3+ of your players are marked injured.',uses:1,roundOnly:true},
  posCaptain:{id:'posCaptain',name:'Positional Captain',icon:'🎯',
    desc:'Captain bonus goes to the best-scoring player at a chosen position that round, not your named captain.',uses:3,roundOnly:true},
  splitCaptain:{id:'splitCaptain',name:'Split Captain',icon:'⚡',
    desc:'Split the captain bonus across C and VC — each gets 1.5× instead of one player getting 2×.',uses:3,roundOnly:true},
  benchInsurance:{id:'benchInsurance',name:'Bench Insurance',icon:'🛡️',
    desc:'Your best-scoring interchange player also counts even if all starters played.',uses:3,roundOnly:true},
  vcLock:{id:'vcLock',name:'VC Lock',icon:'🔒',
    desc:'VC only activates as captain if your captain scores below a threshold you set. Activate per-round.',uses:999,roundOnly:false},
};
/* squad layout (adjustable in Rules & Settings) — defaults: 13 starters, 4 bench, 4 reserves */
let FIELD_STRUCT=[[1,1],[2,3],[3,2],[4,2],[5,2],[6,3]];
let BENCH_N=4, RES_N=4, STARTERS_N=13, SQUAD_N=21, DRAFT_ROSTER=17;
function applyLayout(){
  const L=(S&&S.settings&&S.settings.layout)||DEFAULT_LAYOUT;
  FIELD_STRUCT=[[1,L.HOK],[2,L.MID],[3,L.EDG],[4,L.HLF],[5,L.CTR],[6,L.WFB]];
  BENCH_N=Math.max(0,L.bench);RES_N=Math.max(0,L.res);
  STARTERS_N=FIELD_STRUCT.reduce((s,x)=>s+x[1],0);
  SQUAD_N=STARTERS_N+BENCH_N+RES_N;
  DRAFT_ROSTER=STARTERS_N+BENCH_N;
}

const AI_NAMES=['Steeden Slingers','Bunker Review FC','Chicken Wing Tacklers','The Mortgage Siders','Falcon Magnets','Six Again Merchants','Captain’s Knock','Golden Point Gurus','Sin Bin Scholars','The Bye Round Bandits','Up The Jumper FC','Grubber Kings','Cardboard Cutouts','Halfback Flu','The Obstruction Rule','Dummy Half Heroes'];

/* ================= STATE ================= */
let S=null;
const STORE_KEY='nrlf_app_v2';
function defaultState(){
  return {
    seed:Math.floor(Math.random()*1e9),
    settings:JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    round:1, /* next round to simulate */
    season:{rounds:{}}, /* r -> {stats:{pid:[...]}, fix:[[h,a]..], bye:clubIdx} */
    prices:{}, /* pid -> current price */
    classic:{squad:[],line:emptyLine(),tradesRound:0,tradesSeason:0,history:{},
      chips:{active:{},used:{},injured:[]}},
    league:null,       /* classic league {name,teams:[{name,squad,line,ai}],fix:{},...} */
    customLeague:null, /* {name,created,chipsEnabled,cap,tradesPerRound,seasonTrades,captainMult,benchScores,bank,tradesRound,tradesSeason} */
    draft:null,        /* {phase,league,size,teams,me,pickNo,done,log,history} */
    watchlist:[],      /* [pid,...] starred players */
    teamNewsPrefs:{followedPlayers:[],followedClubs:[],lastVisitedAt:null},
    priceHistory:{},   /* {round:{pid:price}} snapshot after each simulated round */
    plannedTrades:[],  /* [{out:pid,in:pid,note:''}] staged future trades */
    corrections:{},    /* {r:{pid:pts}} commissioner score overrides */
    origin:{picks:{1:{},2:{},3:{}},game:1,tab:'picks',league:{code:null,teamId:null,name:null,teamName:null}},
    sooAuth:null,
    user:null,   /* {name,email,method,initials} */
    ui:{page:'classic',classicTab:'team',draftPostTab:'team',trPage:'classic',trTab:'centre',mcRound:1,mcMatch:0,plSort:'avg',plDir:-1,plPos:0,plClub:-1,plQ:'',plSearch:'',slotPick:null,draftQ:'',draftPos:0}
  };
}
function emptyLine(){
  const st={};for(const[pi,n]of FIELD_STRUCT)st[pi]=Array(n).fill(null);
  return {starters:st,bench:Array(BENCH_N).fill(null),res:Array(RES_N).fill(null),c:null,vc:null};
}
/* resize an existing lineup to the current layout; returns players that no longer fit */
function resizeLine(line){
  const overflow=[];
  for(const[pi,n]of FIELD_STRUCT){
    const arr=line.starters[pi]||[];
    while(arr.length>n){const p=arr.pop();if(p!=null)overflow.push(p)}
    while(arr.length<n)arr.push(null);
    line.starters[pi]=arr;
  }
  [['bench',BENCH_N],['res',RES_N]].forEach(([k,N])=>{
    line[k]=line[k]||[];
    while(line[k].length>N){const p=line[k].pop();if(p!=null)overflow.push(p)}
    while(line[k].length<N)line[k].push(null);
  });
  return overflow;
}
function seatInLine(line,pid){
  const p=PLAYERS[pid];
  for(const[pi,n]of FIELD_STRUCT){if(!p.pos.includes(pi))continue;
    const i=line.starters[pi].indexOf(null);if(i>=0){line.starters[pi][i]=pid;return true}}
  let i=line.bench.indexOf(null);if(i>=0){line.bench[i]=pid;return true}
  i=line.res.indexOf(null);if(i>=0){line.res[i]=pid;return true}
  return false;
}
/* apply a layout change to every existing team */
function applyLayoutToTeams(){
  /* classic: keep players where possible, refund the rest */
  const ov=resizeLine(S.classic.line);
  ov.forEach(pid=>{
    if(!seatInLine(S.classic.line,pid)){
      S.classic.squad=S.classic.squad.filter(x=>x!==pid);
      if(S.classic.bank!=null)S.classic.bank+=price(pid);
      if(S.classic.line.c===pid)S.classic.line.c=null;
      if(S.classic.line.vc===pid)S.classic.line.vc=null;
    }
  });
  if(S.league)S.league.teams.forEach(t=>{if(!t.ai)return;resizeLine(t.line).forEach(pid=>seatInLine(t.line,pid))});
  if(S.draft&&S.draft.done)S.draft.teams.forEach(t=>autoSetDraftLineup(t)); /* rebuild draft lineups for new layout */
}
function save(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify(S));}catch(e){console.warn('save failed',e)}
  if(window._cloudReady&&typeof window.queueCloudSave==='function')window.queueCloudSave();
}
function load(){
  try{const raw=localStorage.getItem(STORE_KEY);if(raw){S=JSON.parse(raw);
    if(S.settings&&S.settings.cap===11500000)S.settings.cap=13000000; /* migrate old default cap */
    if(S.classic&&!S.classic.chips)S.classic.chips={active:{},used:{},injured:[]}; /* migrate: add chips state */
    if(S.settings&&S.settings.bonusEvents===undefined){S.settings.bonusEvents=false;S.settings.bonusMetre=5;S.settings.bonusTackle=5;S.settings.bonusTryInv=5;S.settings.consistencyBonus=false;S.settings.consistencyStreak=3;S.settings.consistencyMult=1.1;S.settings.upsetBonus=false;S.settings.upsetThreshold=60;S.settings.upsetBonusPts=10;}
    if(S.draft&&!S.draft.phase)S.draft=null; /* migrate: reset legacy draft — new league-code flow required */
    if(!S.watchlist)S.watchlist=[];
    if(!S.teamNewsPrefs)S.teamNewsPrefs={followedPlayers:[],followedClubs:[],lastVisitedAt:null};
    if(!S.ui.classicTab)S.ui.classicTab='team';
    if(!S.ui.draftPostTab)S.ui.draftPostTab='team';
    if(!S.ui.trPage)S.ui.trPage='classic';
    if(!S.ui.trTab)S.ui.trTab='centre';
    if(['scoring','bonuses','rules'].includes(S.ui.customTab))S.ui.customTab='settings';
    if(!S.priceHistory)S.priceHistory={};
    if(!S.plannedTrades)S.plannedTrades=[];
    if(!S.corrections)S.corrections={};
    if(!S.origin)S.origin={picks:{1:{},2:{},3:{}},game:1,tab:'picks'};
    if(S.ui.plSearch===undefined)S.ui.plSearch='';
    if(S.customLeague&&S.customLeague.cap==null){
      S.customLeague.cap=S.settings.cap;
      S.customLeague.tradesPerRound=S.settings.tradesPerRound;
      S.customLeague.seasonTrades=S.settings.seasonTrades;
      S.customLeague.captainMult=S.settings.captainMult||2;
      S.customLeague.benchScores=S.settings.benchScores!==false;
      S.customLeague.bank=null;
      S.customLeague.tradesRound=0;
      S.customLeague.tradesSeason=0;
    }
    if(S.settings&&S.settings.bestBall===undefined)S.settings.bestBall=false;
    if(S.settings&&!S.settings.scoringPeriod)S.settings.scoringPeriod=1;
    /* new model: startRound — set to 1 for existing teams, 0 for fresh starts */
    if(S.classic&&S.classic.startRound==null)S.classic.startRound=S.classic.squad.length>0?1:0;
    /* auto-advance any rounds that have real data but weren't applied yet */
    if(S.round<=MAXR||isNaN(MAXR)){applyDataPatch();if(!isNaN(MAXR))autoAdvanceRounds(S.round-1);}
    else if(S.round<MAXR+1)S.round=MAXR+1;
    if(S.draft&&!S.draft.waivers)S.draft.waivers=[];
    if(S.settings&&!S.settings.layout){ /* migrate: preserve this save's existing squad shape */
      S.settings.layout={...DEFAULT_LAYOUT};
      try{
        for(const[pi,]of FIELD_STRUCT)S.settings.layout[POSN[pi]]=(S.classic.line.starters[pi]||[]).length||DEFAULT_LAYOUT[POSN[pi]];
        S.settings.layout.bench=S.classic.line.bench.length||4;
        S.settings.layout.res=S.classic.line.res.length||4;
      }catch(e){}
    }
    return}}catch(e){}
  S=defaultState();
  PLAYERS.forEach(p=>S.prices[p.id]=p.basePrice);
  save();
}

/* ================= AUTH ================= */
function showApp(){
  /* Check for password reset token in URL */
  const _resetTok=new URLSearchParams(window.location.search).get('resetToken');
  if(_resetTok&&!S.sooAuth){
    sessionStorage.setItem('resetToken',_resetTok);
    window.history.replaceState({},'',window.location.pathname);
    const lp=document.getElementById('login-page');const sh=document.getElementById('app-shell');
    const sl=document.getElementById('soo-login-page');
    if(lp)lp.style.display='none';if(sh)sh.style.display='none';
    if(sl){sl.style.display='flex';setTimeout(()=>{sooShowAuthTab('reset');},50);}
    return;
  }
  const shell=document.getElementById('app-shell');
  const sooLoginEl=document.getElementById('soo-login-page');
  /* Single unified auth — one account for everything */
  if(!S.sooAuth||(!S.sooAuth.authenticated&&!S.sooAuth.token)){
    document.getElementById('login-page').style.display='none';
    if(shell)shell.style.display='none';
    if(sooLoginEl)sooLoginEl.style.display='flex';
    return;
  }
  /* Authenticated — populate user from sooAuth */
  if(sooLoginEl)sooLoginEl.style.display='none';
  document.getElementById('login-page').style.display='none';
  S.user={name:S.sooAuth.name,email:S.sooAuth.email,method:'soo',initials:(S.sooAuth.name||'?').slice(0,1).toUpperCase()};
  if(shell)shell.style.display='flex';
  const chip=document.getElementById('user-chip');
  if(chip){chip.style.display='flex';chip.innerHTML=`<div class="av">${S.user.initials}</div><span class="un">${esc(S.user.name)}</span>`;}
  const sp=document.getElementById('sidebar-prof');
  if(sp){sp.style.display='flex';sp.innerHTML=`<div class="av-sm">${S.user.initials}</div><div><b>${esc(S.user.name)}</b><span>Season 2026</span></div>`;}
}
function showUserMenu(){
  openModal(`<div style="text-align:center;padding:10px 0">
   <div style="width:56px;height:56px;border-radius:50%;background:var(--acc);color:#0b1220;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin:0 auto 12px">${S.user.initials}</div>
   <div style="font-weight:700;font-size:16px">${esc(S.user.name)}</div>
   <div style="color:var(--dim);font-size:13px;margin-bottom:20px">${esc(S.user.email)}</div>
   <button class="btn danger" style="width:100%" onclick="closeModal();sooSignOut()">Sign out</button>
  </div>`);
}
/* ================= HELPERS ================= */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmtK=n=>'$'+Math.round(n/1000)+'k';
const fmtM=n=>'$'+(n/1e6).toFixed(2)+'M';
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function poisson(rng,lam){if(lam<=0)return 0;let L=Math.exp(-lam),k=0,p=1;do{k++;p*=rng()}while(p>L);return k-1}
function gauss(rng){let u=0,v=0;while(u===0)u=rng();while(v===0)v=rng();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)}
/* price() defined in engine (round-aware official prices) */
function posStr(p){return p.pos.map(x=>POSN[x]).join('/')}
function initials(name){const w=name.split(' ');return (w[0][0]+(w[w.length-1][0]||'')).toUpperCase()}

/* jersey avatar SVG */
function avatar(p,sz=44){
  const c=CLUBS[p.sq];
  const txtCol=(c.c2==='#FFFFFF'||c.c2==='#FBBF15'||c.c2==='#FFDD02'||c.c2==='#FFC425'||c.c2==='#F3D03E'||c.c2==='#ECA72C')?c.c2:'#fff';
  return `<svg class="avatar-sm" width="${sz}" height="${sz}" viewBox="0 0 48 48">
   <rect width="48" height="48" rx="8" fill="${c.c1}"/>
   <path d="M14 14 L20 10 L24 13 L28 10 L34 14 L38 20 L33 24 L33 40 L15 40 L15 24 L10 20 Z" fill="${c.c1}" stroke="${c.c2}" stroke-width="2.2"/>
   <path d="M14 14 L20 10 L24 13 L28 10 L34 14 L36 17 L12 17 Z" fill="${c.c2}" opacity="0.9"/>
   <text x="24" y="33" text-anchor="middle" font-size="11" font-weight="800" fill="${txtCol}" font-family="Segoe UI,sans-serif">${initials(p.name)}</text>
  </svg>`;
}
function clubDot(ci){return `<span class="dot" style="background:${CLUBS[ci].c1};border:1px solid ${CLUBS[ci].c2}"></span>`}
