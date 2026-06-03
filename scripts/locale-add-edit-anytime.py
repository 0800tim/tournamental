#!/usr/bin/env python3
"""
Add bracket.hero.edit_anytime_{heading,lead,detail} keys to every
non-English locale file. Translations below match the existing
voice / tone of each locale (friendly, direct, native idioms for
"predict", "kickoff", "bracket").

Usage:
    python3 scripts/locale-add-edit-anytime.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "apps/web/locales"

TRANSLATIONS = {
    "ar": {
        "heading": "مرونة في التعديل طوال البطولة",
        "lead": "أدخل جميع توقعات المباريات الآن، حتى يرى متابعوك كيف تتوقع طريق فريقك إلى المجد.",
        "detail": "غيّرها متى شئت، حتى صافرة بداية كل مباراة؛ عندها يُقفل ذلك التوقع. عدّل مع تغيّر الفورمة ووصول الإصابات وإعادة كل دور لرسم الجدول. لا نعاقبك على التوقعات الخاطئة المبكرة كما تفعل تطبيقات البراكيت الأخرى!",
    },
    "bs": {
        "heading": "Fleksibilno za promjene tokom cijelog turnira",
        "lead": "Unesite sve tipove sada, da vaši pratioci vide kako predviđate put vašeg tima do slave.",
        "detail": "Mijenjajte ih kad god želite, sve do prvog zvižduka svake utakmice; tada se taj tip zaključava. Prilagodite se kako se mijenja forma, kako stižu povrede, kako svaka faza preuređuje grafikon. Ne kažnjavamo vas za rane pogrešne tipove kao druge bracket aplikacije!",
    },
    "cs": {
        "heading": "Flexibilní pro úpravy během celého turnaje",
        "lead": "Zadejte všechny tipy hned teď, ať vaši sledující vidí, jak předpovídáte cestu vašeho týmu za slávou.",
        "detail": "Měňte je kdykoli, až do výkopu každého zápasu; v tu chvíli se tip uzamkne. Upravujte podle formy, podle zranění, podle toho, jak každé kolo přepisuje pavouka. Netrestáme vás za rané chybné tipy jako jiné bracket aplikace!",
    },
    "de": {
        "heading": "Flexibel anpassbar während des ganzen Turniers",
        "lead": "Gib jetzt alle Tipps ab, damit deine Follower sehen können, wie du den Weg deines Teams zum Titel voraussagst.",
        "detail": "Ändere sie jederzeit, bis zum Anpfiff jedes Spiels - dann wird der Tipp gesperrt. Passe an, wenn sich die Form ändert, Verletzungen auftreten oder jede Phase das Turnier neu mischt. Wir bestrafen dich nicht für frühe Fehltipps wie andere Bracket-Apps!",
    },
    "es": {
        "heading": "Flexible para cambiar durante todo el torneo",
        "lead": "Haz todos los pronósticos ahora para que tus seguidores vean cómo predices el camino de tu equipo a la gloria.",
        "detail": "Cámbialos cuando quieras, hasta el silbato inicial de cada partido; en ese momento ese pronóstico se bloquea. Ajusta a medida que cambia el estado de forma, llegan lesiones y cada fase reconfigura el cuadro. ¡No te penalizamos por aciertos tardíos como otras apps de brackets!",
    },
    "fa": {
        "heading": "انعطاف‌پذیر برای تغییر در طول تورنمنت",
        "lead": "همه پیش‌بینی‌ها را اکنون وارد کنید تا دنبال‌کنندگانتان ببینند چطور مسیر تیمتان به افتخار را پیش‌بینی می‌کنید.",
        "detail": "هر وقت خواستید تغییرشان دهید، تا سوت آغاز هر بازی؛ در آن لحظه آن پیش‌بینی قفل می‌شود. با تغییر فرم، با مصدومیت‌ها، با هر مرحله که جدول را بازنویسی می‌کند، تنظیم کنید. ما شما را برای پیش‌بینی‌های اشتباه زودهنگام مجازات نمی‌کنیم مثل سایر اپ‌های براکت!",
    },
    "fr": {
        "heading": "Flexible jusqu'à la fin du tournoi",
        "lead": "Faites tous vos pronostics maintenant, pour que vos amis voient comment vous imaginez le parcours de votre équipe.",
        "detail": "Modifiez-les à tout moment, jusqu'au coup d'envoi de chaque match : à cet instant, le pronostic se verrouille. Ajustez quand la forme change, quand les blessures tombent, quand chaque tour redessine le tableau. On ne vous punit pas pour les mauvais choix anticipés, contrairement aux autres apps de brackets !",
    },
    "hr": {
        "heading": "Fleksibilno za promjene tijekom cijelog turnira",
        "lead": "Unesite sve tipove odmah, kako bi vaši pratitelji vidjeli kako predviđate put vašeg tima do slave.",
        "detail": "Mijenjajte ih kad god želite, sve do prvog zvižduka svake utakmice; u tom trenutku se taj tip zaključava. Prilagodite se kako se mijenja forma, kako stižu ozljede, kako svaka faza preuređuje grafikon. Ne kažnjavamo vas za rane krive tipove kao druge bracket aplikacije!",
    },
    "hu": {
        "heading": "Rugalmasan változtatható az egész torna alatt",
        "lead": "Adja meg most az összes meccs tippjét, hogy a követői lássák, hogyan jósolja meg csapata útját a dicsőségig.",
        "detail": "Bármikor megváltoztathatja, egészen az egyes meccsek kezdő sípszójáig; abban a pillanatban az a tipp rögzül. Igazítsa, ahogy változik a forma, ahogy jönnek a sérülések, ahogy minden kör átírja a tablót. Nem büntetjük a korai téves tippeket, ahogy más bracket appok teszik!",
    },
    "it": {
        "heading": "Flessibile da modificare per tutto il torneo",
        "lead": "Inserisci subito tutti i pronostici, così i tuoi follower possono vedere come prevedi il cammino della tua squadra fino alla gloria.",
        "detail": "Cambiali quando vuoi, fino al fischio d'inizio di ogni partita; in quel momento il pronostico si blocca. Aggiusta quando cambia la forma, quando arrivano gli infortuni, quando ogni turno ridisegna il tabellone. Non ti puniamo per i pronostici sbagliati anticipati come fanno altre app!",
    },
    "ja": {
        "heading": "大会期間中いつでも変更可能",
        "lead": "まず全試合の予想を入れて、フォロワーがあなたの予想する優勝への道筋を見られるようにしましょう。",
        "detail": "各試合のキックオフの直前まで、何度でも変更できます。キックオフの瞬間にその予想はロックされます。調子の変化、怪我、各ラウンドのトーナメント再構成に合わせて調整しましょう。他のブラケットアプリのように、早い段階での予想ミスをペナルティにすることはありません!",
    },
    "ko": {
        "heading": "토너먼트 내내 자유롭게 변경 가능",
        "lead": "지금 모든 경기 예측을 입력해서 팔로워들이 당신이 응원하는 팀의 우승 경로를 어떻게 예측하는지 볼 수 있게 하세요.",
        "detail": "각 경기 킥오프 직전까지 언제든 변경할 수 있고, 킥오프 순간 해당 예측이 잠깁니다. 컨디션 변화, 부상 발생, 각 라운드별 대진표 재편성에 맞춰 조정하세요. 다른 브라켓 앱들처럼 이른 시점의 잘못된 픽에 대해 페널티를 주지 않습니다!",
    },
    "mi": {
        "heading": "Ngāwari ki te whakarerekē i te wā o te whakataetae",
        "lead": "Whakaurua katoa ngā matakitaki ināianei, kia kite ai ō kaiwhai i tō tirohanga mō te ara o tō kapa ki te toa.",
        "detail": "Whakarerekē ai ahakoa āwhea, tae noa ki te whana tuatahi o ia tākaro; i taua wā ka kati tērā matakitaki. Whakatika ai i te rerekētanga o te āhua, i te urutanga mai o ngā whara, i te wā ka huri ngā wāhanga ki te tuhi anō i te whakaaturanga. Kāore mātou e whiu i a koe mō ngā matakitaki hē moata pēnei i ētahi atu pūmanawa bracket!",
    },
    "nl": {
        "heading": "Flexibel om aan te passen tijdens het hele toernooi",
        "lead": "Voer nu al je voorspellingen in, zodat je volgers kunnen zien hoe jij het pad van je team naar de glorie voorziet.",
        "detail": "Pas ze aan wanneer je wilt, tot het beginsignaal van elke wedstrijd; op dat moment wordt die voorspelling vastgezet. Verander mee met de vorm, met blessures, met elke ronde die het schema opnieuw bepaalt. We straffen je niet voor vroege foutieve picks zoals andere bracket-apps doen!",
    },
    "no": {
        "heading": "Fleksibel å endre gjennom hele turneringen",
        "lead": "Legg inn alle kamptips nå, så følgerne dine ser hvordan du spår laget ditt til seier.",
        "detail": "Endre dem når du vil, helt frem til avspark for hver kamp; da låses tippet. Juster når formen endrer seg, når skader kommer, når hver runde tegner bracketen på nytt. Vi straffer deg ikke for tidlige feiltips slik andre bracket-apper gjør!",
    },
    "pt-BR": {
        "heading": "Flexível pra mudar durante todo o torneio",
        "lead": "Faça todos os palpites agora pra que seus amigos vejam como você prevê o caminho do seu time até a glória.",
        "detail": "Mude quando quiser, até o apito inicial de cada jogo; nesse momento, aquele palpite trava. Ajuste conforme a fase do time muda, conforme lesões aparecem, conforme cada rodada redesenha o chaveamento. A gente não pune palpites errados feitos cedo como os outros apps fazem!",
    },
    "pt-PT": {
        "heading": "Flexível para mudar durante todo o torneio",
        "lead": "Faz todos os palpites agora para os teus seguidores verem como prevês o caminho da tua equipa até à glória.",
        "detail": "Muda quando quiseres, até ao apito inicial de cada jogo; nesse momento, aquele palpite fica fechado. Ajusta conforme a forma muda, conforme há lesões, conforme cada fase redesenha o quadro. Não te penalizamos por palpites errados feitos cedo como as outras apps fazem!",
    },
    "sv": {
        "heading": "Flexibel att ändra under hela turneringen",
        "lead": "Lägg in alla matchtips nu så att dina följare ser hur du tror att ditt lag tar sig till glansen.",
        "detail": "Ändra dem när du vill, ända fram till avspark i varje match; då låses tipset. Justera när formen ändras, när skador kommer, när varje omgång gör om bracketen. Vi straffar dig inte för tidiga felaktiga tips som andra bracket-appar gör!",
    },
    "tr": {
        "heading": "Turnuva boyunca esnek bir şekilde değiştirilebilir",
        "lead": "Tüm tahminleri şimdi gir, böylece takipçilerin takımının zafere giden yolunu nasıl öngördüğünü görsün.",
        "detail": "İstediğin zaman değiştir, her maçın başlama düdüğüne kadar; o anda o tahmin kilitlenir. Form değişince, sakatlıklar gelince, her tur grafiği yeniden çizince ayarla. Diğer bracket uygulamaları gibi erken hatalı tahminler için seni cezalandırmıyoruz!",
    },
    "uz": {
        "heading": "Butun turnir davomida o'zgartirish mumkin",
        "lead": "Barcha bashoratlarni hozir kiriting, shunda kuzatuvchilaringiz jamoangizning shon-sharafga yo'lini qanday tasavvur qilayotganingizni ko'rishadi.",
        "detail": "Har qachon o'zgartiring, har bir o'yinning hushtak chalishigacha; o'sha lahzada bashorat qulflanadi. Forma o'zgarsa, jarohatlar paydo bo'lsa, har bosqich panjarani qayta tarzsa, sozlang. Boshqa bracket ilovalari kabi erta noto'g'ri tanlovlar uchun jazo bermaymiz!",
    },
    "zh-CN": {
        "heading": "整个赛事期间灵活更改",
        "lead": "现在就输入所有比赛的预测，让你的关注者看到你预测自己球队通往荣耀的路线。",
        "detail": "随时都可以更改，一直到每场比赛开球的那一刻——开球瞬间那场比赛的预测就被锁定。根据球队状态、伤病情况、每一轮淘汰赛重新洗牌的对阵调整。我们不会像其他对阵图应用那样惩罚你早期的错误选择!",
    },
}


def insert_keys(data: dict, t: dict) -> None:
    """Insert the 3 edit_anytime keys into bracket.hero of *data*.
    Keys are inserted preserving the existing dict order: after
    `lede` if present, else appended.
    """
    bracket = data.setdefault("bracket", {})
    hero = bracket.setdefault("hero", {})
    new = {
        "edit_anytime_heading": t["heading"],
        "edit_anytime_lead": t["lead"],
        "edit_anytime_detail": t["detail"],
    }
    # Rebuild the hero dict so the 3 keys land right after `lede`
    # (matching the en.json ordering) instead of at the end of an
    # arbitrary insertion order.
    rebuilt: dict = {}
    inserted = False
    for k, v in hero.items():
        rebuilt[k] = v
        if k == "lede" and not inserted:
            rebuilt.update(new)
            inserted = True
    if not inserted:
        rebuilt.update(new)
    bracket["hero"] = rebuilt


def main() -> None:
    for code, t in TRANSLATIONS.items():
        path = ROOT / f"{code}.json"
        if not path.exists():
            print(f"  skip (missing): {code}")
            continue
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        insert_keys(data, t)
        # Preserve trailing newline.
        out = json.dumps(data, indent=2, ensure_ascii=False)
        if raw.endswith("\n"):
            out += "\n"
        path.write_text(out, encoding="utf-8")
        print(f"  ✓ {code}")


if __name__ == "__main__":
    main()
