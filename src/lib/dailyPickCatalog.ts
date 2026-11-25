type Release = readonly [id: string, title: string, year: number];
type ArtistGroup = readonly [artist: string, releases: readonly Release[]];
export const dailyPickCatalog = {
  "Hip Hop": [
    ["Kendrick Lamar", [["1171563506","Overly Dedicated",2010],["1475039105","Section.80",2011],["1471277623","good kid, m.A.A.d city",2012]]],
    ["Baby Keem", [["1465954836","The Sound of Bad Habit",2018],["1472614374","DIE FOR MY BITCH",2019],["1587040935","The Melodic Blue",2021]]],
    ["Drake", [["1452017773","So Far Gone",2009],["1440762388","Thank Me Later",2010],["1440642493","Take Care (Deluxe Version)",2011],["1440829462","Nothing Was the Same (Deluxe)",2013],["1440839718","If You're Reading This It's Too Late",2015]]],
    ["Nas", [["662324135","Illmatic",1994],["211507540","It Was Written",1996],["170439443","I Am...",1999],["203759842","Nastradamus",1999]]],
    ["Kanye West", [["1412872568","The College Dropout",2004],["1440668749","Late Registration",2005],["1442845779","Graduation",2007],["1441410287","808s & Heartbreak",2008],["1440742903","My Beautiful Dark Twisted Fantasy",2010]]],
  ],
  "Afrobeats": [
    ["Burna Boy", [["1061880098","On a Spaceship",2015],["1337974012","Outside",2018],["1471446047","African Giant",2019],["1527617123","Twice As Tall",2020],["1623677591","Love, Damini",2022],["1704311790","I Told Them...",2023],["1828535197","No Sign of Weakness",2025]]],
    ["Wizkid", [["1245387917","Sounds From the Other Side",2017],["1627800102","Ayo",2017],["1531532301","Made In Lagos",2020],["1651723071","More Love, Less Ego",2022],["1780459822","Morayo",2024]]],
    ["Rema", [["1521265051","Rema Compilation",2020],["1683358108","Rave & Roses Ultra",2023],["1756305992","HEIS",2024]]],
    ["Tems", [["1532252592","For Broken Ears",2020],["1750361972","Born in the Wild",2024],["1853635930","Love Is A Kingdom",2025]]],
  ],
  "R&B": [
    ["SZA", [["852343474","Z - EP",2014],["1239977075","Ctrl",2017],["1658650093","SOS",2022]]],
    ["GIVĒON", [["1504322983","TAKE TIME",2020],["1556122764","When It's All Said And Done... Take Time",2021],["1627365840","Give Or Take",2022],["1815356726","BELOVED",2025]]],
    ["Beyoncé", [["201274359","Dangerously in Love",2003],["296790269","B'Day",2006],["296016891","I AM...SASHA FIERCE",2008]]],
    ["The Weeknd", [["1558941834","House of Balloons (Original)",2011],["1714908584","Trilogy",2012],["1422667786","Kiss Land",2013],["1440826239","Beauty Behind the Madness",2015],["1440871397","Starboy",2016],["1499378108","After Hours",2020]]],
    ["Stevie Wonder", [["1444119065","The Jazz Soul of Little Stevie",1962],["1443432275","With a Song in My Heart",1963],["1443113004","Up-Tight",1966],["1443256168","Down to Earth",1966],["1443078085","I Was Made To Love Her",1967]]],
    ["Rihanna", [["1440867092","Music of the Sun",2005],["1472503760","Good Girl Gone Bad",2007],["1440885156","Rated R",2009],["1440895867","Loud (Deluxe)",2010]]],
  ],
  "Pop": [
    ["Michael Jackson", [["1443228603","Ben",1972],["1443284801","Music & Me",1973],["1444039101","Forever, Michael",1975],["186166282","Off the Wall",1979],["269572838","Thriller",1982]]],
    ["Dua Lipa", [["1227781643","Dua Lipa",2017],["1538003494","Future Nostalgia",2020],["1745741774","Radical Optimism",2024]]],
    ["Taylor Swift", [["1440924803","Fearless",2008],["1440920310","Speak Now",2010],["1440935340","Red",2012],["1440935467","1989",2014],["1440933849","reputation",2017]]],
    ["Ariana Grande", [["1440860819","Yours Truly",2013],["1440825039","My Everything",2014],["1440843597","Dangerous Woman",2016],["1399202539","Sweetener",2018],["1450330588","thank u, next",2019]]],
    ["Adele", [["1545382283","19",2008],["1544491232","21",2011],["1544494115","25",2015],["1590035691","30",2021]]],
    ["The Beatles", [["1441164816","Please Please Me",1963],["1441164362","With The Beatles",1963],["1441164416","A Hard Day's Night",1964],["1441165005","Beatles For Sale",1964],["1441164524","Help!",1965]]],
    ["Coldplay", [["1122782080","Parachutes",2000],["1122775993","A Rush of Blood to the Head",2002],["1123076757","X&Y",2005],["1122773394","Viva La Vida or Death and All His Friends",2008]]],
  ],
} as const satisfies Record<string, readonly ArtistGroup[]>;

// Keep this list empty unless the edition has individually cleared homepage artwork.
export const approvedDailyCoverIds: ReadonlySet<string> = new Set();
// Approved local photos should be attributed according to their individual license.
export const approvedDailyArtistPhotos: Readonly<Record<string, string>> = {};
