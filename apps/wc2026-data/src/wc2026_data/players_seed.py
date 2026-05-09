"""Seed roster data for the 2026 World Cup.

Until each FA confirms its 26-man squad (announced ~late May 2026 per FIFA's
deadline), we ship a starter set of confirmed first-team regulars per
qualified nation. The schema mirrors `data/wc2022-final-players.csv`:

    player_id, name, number, country, wikidata_q, image_url, attribution

Players in this seed are flagged with `pre_tournament=true` in the JSON
emit. Once squads are announced, the scrape script's `--source-only=fifa`
flag refreshes from FIFA's official roster pages (or the FA-specific
release if FIFA's page lags).

Numbers are placeholder (most players use their club number; FAs assign
WC numbers ~1 week before kickoff).
"""

from __future__ import annotations

# Format: country_code -> list[(player_id_suffix, name, number, wikidata_q)]
# Image URL + attribution are resolved at emit time from a Wikidata Commons
# lookup; if missing, we leave them as None and the avatar package falls
# back to a procedural face.
SEED_ROSTERS: dict[str, list[tuple[str, str, int, str]]] = {
    "ARG": [
        ("MESSI", "Lionel Messi", 10, "Q615"),
        ("E_MARTINEZ", "Emiliano Martínez", 23, "Q3275904"),
        ("MOLINA", "Nahuel Molina", 26, "Q22082590"),
        ("ROMERO", "Cristian Romero", 13, "Q28058687"),
        ("OTAMENDI", "Nicolás Otamendi", 19, "Q182063"),
        ("ACUNA", "Marcos Acuña", 8, "Q17462635"),
        ("DE_PAUL", "Rodrigo De Paul", 7, "Q6110670"),
        ("MAC_ALLISTER", "Alexis Mac Allister", 20, "Q33297140"),
        ("E_FERNANDEZ", "Enzo Fernández", 24, "Q96105248"),
        ("DI_MARIA", "Ángel Di María", 11, "Q251683"),
        ("J_ALVAREZ", "Julián Álvarez", 9, "Q98641810"),
    ],
    "BRA": [
        ("VINICIUS", "Vinicius Jr.", 7, "Q17451832"),
        ("RAPHINHA", "Raphinha", 11, "Q23015660"),
        ("RODRYGO", "Rodrygo", 9, "Q57498611"),
        ("CASEMIRO", "Casemiro", 5, "Q3499053"),
        ("MARQUINHOS", "Marquinhos", 4, "Q1438268"),
        ("ALISSON", "Alisson Becker", 1, "Q19828054"),
        ("DANILO", "Danilo", 2, "Q3251268"),
        ("BRUNO_G", "Bruno Guimarães", 8, "Q60634443"),
    ],
    "FRA": [
        ("MBAPPE", "Kylian Mbappé", 10, "Q19359939"),
        ("DEMBELE", "Ousmane Dembélé", 11, "Q18684030"),
        ("GRIEZMANN", "Antoine Griezmann", 7, "Q3289492"),
        ("MAIGNAN", "Mike Maignan", 16, "Q19601893"),
        ("KOUNDE", "Jules Koundé", 5, "Q39605400"),
        ("UPAMECANO", "Dayot Upamecano", 4, "Q22327729"),
        ("THEO_HERNANDEZ", "Theo Hernández", 22, "Q19828144"),
        ("TCHOUAMENI", "Aurélien Tchouaméni", 8, "Q60664194"),
    ],
    "ENG": [
        ("BELLINGHAM", "Jude Bellingham", 10, "Q97157330"),
        ("KANE", "Harry Kane", 9, "Q5673502"),
        ("FODEN", "Phil Foden", 11, "Q22337568"),
        ("PICKFORD", "Jordan Pickford", 1, "Q19362953"),
        ("STONES", "John Stones", 5, "Q14939218"),
        ("WALKER", "Kyle Walker", 2, "Q295862"),
        ("RICE", "Declan Rice", 4, "Q39103196"),
        ("SAKA", "Bukayo Saka", 7, "Q67073611"),
    ],
    "USA": [
        ("PULISIC", "Christian Pulisic", 10, "Q22667221"),
        ("MCKENNIE", "Weston McKennie", 8, "Q42287048"),
        ("ADAMS", "Tyler Adams", 4, "Q42287198"),
        ("DEST", "Sergiño Dest", 2, "Q56602797"),
        ("REYNA", "Gio Reyna", 7, "Q97064419"),
        ("TURNER", "Matt Turner", 1, "Q33203148"),
        ("REAM", "Tim Ream", 13, "Q1620488"),
        ("WEAH", "Timothy Weah", 21, "Q33060562"),
    ],
    "MEX": [
        ("OCHOA", "Guillermo Ochoa", 13, "Q371478"),
        ("LOZANO", "Hirving Lozano", 22, "Q14534946"),
        ("VEGA", "Alexis Vega", 11, "Q42284470"),
        ("E_ALVAREZ", "Edson Álvarez", 4, "Q60727099"),
        ("CHAVEZ", "Luis Chávez", 18, "Q47009027"),
    ],
    "CAN": [
        ("DAVIES", "Alphonso Davies", 19, "Q31092497"),
        ("DAVID", "Jonathan David", 20, "Q42301731"),
        ("LARIN", "Cyle Larin", 17, "Q21080574"),
        ("ST_CLAIR", "Dayne St. Clair", 1, "Q60728085"),
        ("KAYE", "Mark-Anthony Kaye", 14, "Q33129083"),
    ],
    "GER": [
        ("MUSIALA", "Jamal Musiala", 10, "Q98581057"),
        ("WIRTZ", "Florian Wirtz", 17, "Q83296017"),
        ("KIMMICH", "Joshua Kimmich", 6, "Q19953987"),
        ("NEUER", "Manuel Neuer", 1, "Q83933"),
        ("HAVERTZ", "Kai Havertz", 7, "Q60661632"),
    ],
    "POR": [
        ("RONALDO", "Cristiano Ronaldo", 7, "Q11571"),
        ("B_FERNANDES", "Bruno Fernandes", 8, "Q15620038"),
        ("BERNARDO", "Bernardo Silva", 10, "Q15968220"),
        ("DIAS", "Rúben Dias", 4, "Q22667290"),
        ("R_LEAO", "Rafael Leão", 11, "Q60661675"),
    ],
    "NED": [
        ("VAN_DIJK", "Virgil van Dijk", 4, "Q1517816"),
        ("DEPAY", "Memphis Depay", 10, "Q3334416"),
        ("DE_JONG", "Frenkie de Jong", 21, "Q22082728"),
        ("GAKPO", "Cody Gakpo", 8, "Q60631488"),
        ("VERBRUGGEN", "Bart Verbruggen", 1, "Q123056116"),
    ],
    "BEL": [
        ("DE_BRUYNE", "Kevin De Bruyne", 7, "Q367530"),
        ("DOKU", "Jérémy Doku", 11, "Q60661493"),
        ("LUKAKU", "Romelu Lukaku", 9, "Q1245533"),
        ("CASTEELS", "Koen Casteels", 1, "Q1361858"),
    ],
    "CRO": [
        ("MODRIC", "Luka Modrić", 10, "Q102447"),
        ("KOVACIC", "Mateo Kovačić", 8, "Q1356420"),
        ("PERISIC", "Ivan Perišić", 4, "Q1378443"),
        ("LIVAKOVIC", "Dominik Livaković", 1, "Q21058174"),
    ],
    "ESP": [],  # Spain not yet confirmed in seed; placeholder slot.
    "ITA": [
        ("DONNARUMMA", "Gianluigi Donnarumma", 1, "Q22321776"),
        ("BARELLA", "Nicolò Barella", 18, "Q22337482"),
        ("CHIESA", "Federico Chiesa", 14, "Q22337517"),
    ],
    "MAR": [
        ("HAKIMI", "Achraf Hakimi", 2, "Q22082748"),
        ("ZIYECH", "Hakim Ziyech", 7, "Q14941437"),
        ("BOUNOU", "Yassine Bounou", 1, "Q3194091"),
        ("EN_NESYRI", "Youssef En-Nesyri", 19, "Q22337624"),
    ],
    "JPN": [
        ("KUBO", "Takefusa Kubo", 11, "Q57500499"),
        ("MITOMA", "Kaoru Mitoma", 9, "Q60670898"),
        ("ENDO", "Wataru Endo", 6, "Q5575921"),
        ("SUZUKI", "Zion Suzuki", 1, "Q108784712"),
    ],
    "KOR": [
        ("SON", "Son Heung-min", 7, "Q488998"),
        ("LEE_KM", "Lee Kang-in", 18, "Q66365574"),
        ("KIM_MJ", "Kim Min-jae", 4, "Q42289038"),
    ],
    "AUS": [
        ("RYAN", "Mathew Ryan", 1, "Q4140013"),
        ("IRVINE", "Jackson Irvine", 22, "Q15455061"),
        ("ARNOLD", "Riley McGree", 6, "Q31096498"),
    ],
    "SUI": [
        ("XHAKA", "Granit Xhaka", 10, "Q1145614"),
        ("SOMMER", "Yann Sommer", 1, "Q373824"),
        ("AKANJI", "Manuel Akanji", 5, "Q22682810"),
    ],
    "DEN": [
        ("ERIKSEN", "Christian Eriksen", 10, "Q175366"),
        ("HOJBJERG", "Pierre-Emile Højbjerg", 23, "Q19527929"),
        ("SCHMEICHEL", "Kasper Schmeichel", 1, "P104551"),
    ],
    "URU": [
        ("VALVERDE", "Federico Valverde", 15, "Q60634473"),
        ("NUNEZ", "Darwin Núñez", 19, "Q83305012"),
        ("ARAUJO", "Ronald Araújo", 4, "Q60634443"),
    ],
    "COL": [
        ("J_RODRIGUEZ", "James Rodríguez", 10, "Q21737"),
        ("LERMA", "Jefferson Lerma", 8, "Q21193275"),
        ("CUADRADO", "Juan Cuadrado", 11, "Q322318"),
    ],
    "ECU": [
        ("CAICEDO", "Moisés Caicedo", 23, "Q98056022"),
        ("E_VALENCIA", "Enner Valencia", 13, "Q1357829"),
        ("ESTUPINAN", "Pervis Estupiñán", 7, "Q22674094"),
    ],
    "SCO": [
        ("ROBERTSON", "Andrew Robertson", 3, "Q19899867"),
        ("MCTOMINAY", "Scott McTominay", 4, "Q33125196"),
        ("TIERNEY", "Kieran Tierney", 6, "Q22667386"),
    ],
    "WAL": [
        ("RAMSEY", "Aaron Ramsey", 10, "Q252027"),
        ("WILSON", "Harry Wilson", 7, "Q19828071"),
    ],
    "NOR": [
        ("HAALAND", "Erling Haaland", 9, "Q60690750"),
        ("ODEGAARD", "Martin Ødegaard", 8, "Q19353833"),
    ],
    "SEN": [
        ("MENDY", "Édouard Mendy", 16, "Q3580234"),
        ("KOULIBALY", "Kalidou Koulibaly", 3, "Q15991081"),
        ("SARR", "Ismaïla Sarr", 18, "Q22674145"),
    ],
    "EGY": [
        ("SALAH", "Mohamed Salah", 10, "Q15828499"),
        ("EL_SHENAWY", "Mohamed El-Shenawy", 1, "Q4087960"),
    ],
}
