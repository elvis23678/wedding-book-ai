(() => {
    "use strict";

    function random(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    const intro = [
        "Ho analizzato con attenzione tutti i dati del vostro matrimonio.",
        "Mi sono preso qualche secondo per confrontare tutte le possibilità.",
        "Ho simulato l'intero evento considerando tempi, distanza e numero di invitati.",
        "Ho confrontato ogni pacchetto come farei durante una consulenza in studio.",
        "Grazie ai dati inseriti posso darti un consiglio molto preciso."
    ];

    const distanza = [
        "La distanza della location influisce sulla convenienza complessiva.",
        "La trasferta è uno degli elementi più importanti nella scelta del pacchetto.",
        "La location è ben gestibile con il servizio previsto.",
        "La distanza rende ancora più interessante un pacchetto con trasferta inclusa."
    ];

    const invitati = [
        "Il numero degli invitati lascia prevedere un buon flusso durante tutta la giornata.",
        "Con questo numero di ospiti è importante evitare tempi di attesa troppo lunghi.",
        "L'affluenza prevista richiede un'organizzazione ben calibrata.",
        "Il numero degli invitati è perfettamente compatibile con il servizio."
    ];

    const esperienza = [
        "Durante un matrimonio preferisco sempre avere un po' di margine operativo.",
        "Preferisco lasciare qualche spazio in più piuttosto che lavorare con il tempo contato.",
        "L'obiettivo non è solo tatuare, ma far vivere una bellissima esperienza agli ospiti.",
        "Ogni matrimonio è diverso e preferisco sempre ragionare sulla tranquillità dell'evento."
    ];

    const finale = {
        Essential: [
            "Nel vostro caso sceglierei Essential.",
            "Per questo evento Essential è più che sufficiente."
        ],
        Signature: [
            "Se fossi seduto con voi in studio vi consiglierei Signature.",
            "Signature rappresenta il miglior equilibrio tra costo ed esperienza."
        ],
        Luxury: [
            "Personalmente sceglierei Luxury.",
            "Se fosse il matrimonio di un mio amico sceglierei Luxury senza pensarci.",
            "Luxury è il pacchetto che mi farebbe affrontare la giornata con maggiore serenità.",
            "Per questo tipo di matrimonio il mio consiglio va su Luxury."
        ]
    };

    window.generateWeddingExpertAdvice = function (data) {

        let testo = "";

        testo += random(intro) + " ";

        testo += random(distanza) + " ";

        testo += random(invitati) + " ";

        if (data.recommended.extraHours > 0) {
            testo += `Ho considerato anche ${data.recommended.extraHours} ore aggiuntive necessarie per coprire correttamente il servizio. `;
        }

        if (data.km > 50) {
            testo += "Per una location così distante preferisco avere un pacchetto con maggiore copertura della trasferta. ";
        }

        testo += random(esperienza) + " ";

        testo += random(finale[data.recommended.name] || finale.Signature);

        return testo;

    };

})();
