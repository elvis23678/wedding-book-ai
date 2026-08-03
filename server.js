import express from "express";
import pg from "pg";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const {Pool}=pg;
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const app=express();
const PORT=Number(process.env.PORT||3000);

if(!process.env.DATABASE_URL){
  console.error("DATABASE_URL non configurato.");
  process.exit(1);
}

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.NODE_ENV==="production"
    ? {rejectUnauthorized:false}
    : false
});

app.set("trust proxy",1);
app.use(helmet({
  contentSecurityPolicy:false,
  crossOriginEmbedderPolicy:false
}));
app.use(express.json({limit:"1mb"}));

const publicLimiter=rateLimit({
  windowMs:15*60*1000,
  max:60,
  standardHeaders:true,
  legacyHeaders:false
});
app.use("/api/proposals",publicLimiter);

const tatoLimiter=rateLimit({
  windowMs:10*60*1000,
  max:35,
  standardHeaders:true,
  legacyHeaders:false
});

function text(value,max=500){
  return String(value??"").trim().slice(0,max);
}
function number(value,min=0,max=1000000){
  const n=Number(value);
  if(!Number.isFinite(n)) return min;
  return Math.min(max,Math.max(min,n));
}
function boolean(value){
  return value===true||value==="true";
}
function validDate(value){
  const v=text(value,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
}
function proposalId(){
  const now=new Date();
  const stamp=[
    now.getUTCFullYear(),
    String(now.getUTCMonth()+1).padStart(2,"0"),
    String(now.getUTCDate()).padStart(2,"0")
  ].join("");
  return `WTE-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
function isAdult(dateString){
  if(!dateString) return false;
  const birth=new Date(`${dateString}T12:00:00Z`);
  if(Number.isNaN(birth.getTime())) return false;
  const now=new Date();
  let age=now.getUTCFullYear()-birth.getUTCFullYear();
  const beforeBirthday=
    now.getUTCMonth()<birth.getUTCMonth()||
    (now.getUTCMonth()===birth.getUTCMonth()&&now.getUTCDate()<birth.getUTCDate());
  if(beforeBirthday) age--;
  return age>=18;
}
function secureEqual(a,b){
  const aBuffer=Buffer.from(String(a));
  const bBuffer=Buffer.from(String(b));
  if(aBuffer.length!==bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer,bBuffer);
}
function adminAuth(req,res,next){
  const expectedUser=process.env.CRM_USER;
  const expectedPassword=process.env.CRM_PASSWORD;

  if(!expectedUser||!expectedPassword){
    return res.status(503).json({error:"Credenziali CRM non configurate"});
  }

  const header=req.headers.authorization||"";
  if(!header.startsWith("Basic ")){
    res.set("WWW-Authenticate",'Basic realm="WTE CRM"');
    return res.status(401).json({error:"Autenticazione richiesta"});
  }

  const decoded=Buffer.from(header.slice(6),"base64").toString("utf8");
  const split=decoded.indexOf(":");
  const user=split>=0?decoded.slice(0,split):"";
  const password=split>=0?decoded.slice(split+1):"";

  if(!secureEqual(user,expectedUser)||!secureEqual(password,expectedPassword)){
    res.set("WWW-Authenticate",'Basic realm="WTE CRM"');
    return res.status(401).json({error:"Credenziali non valide"});
  }

  next();
}

async function initDb(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'Nuova richiesta',
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      history JSONB NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_updated_at
      ON proposals(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_proposals_status
      ON proposals(status);

    CREATE TABLE IF NOT EXISTS tato_conversations (
      id BIGSERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      user_message TEXT NOT NULL,
      assistant_reply TEXT NOT NULL,
      page_number INTEGER,
      needs_human BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_tato_session
      ON tato_conversations(session_id,created_at DESC);
  `);
}

function normalizeProposal(input={},forcedId=null){
  const firstName=text(input.firstName,80);
  const lastName=text(input.lastName,80);
  const birthDate=validDate(input.birthDate);
  const phone=text(input.phone,40).replace(/[^\d+ ]/g,"");
  const email=text(input.email,180).toLowerCase();
  const consent=boolean(input.contactConsent);

  if(!firstName||!lastName){
    const error=new Error("Nome e cognome sono obbligatori");
    error.status=400; throw error;
  }
  if(!birthDate||!isAdult(birthDate)){
    const error=new Error("Il richiedente deve essere maggiorenne");
    error.status=400; throw error;
  }
  if(phone.replace(/\D/g,"").length<9){
    const error=new Error("Numero di cellulare non valido");
    error.status=400; throw error;
  }
  if(!consent){
    const error=new Error("Consenso al contatto obbligatorio");
    error.status=400; throw error;
  }

  const id=forcedId||text(input.id,50)||proposalId();
  const names=text(input.names,180)||[firstName,lastName].join(" ");

  return {
    id,
    status:text(input.status,50)||"Nuova richiesta",
    data:{
      version:text(input.version,50)||"WTE Proposal v1.0",
      names,
      firstName,
      lastName,
      birthDate,
      partnerName:text(input.partnerName,120),
      phone,
      email,
      contactConsent:consent,
      consentAt:text(input.consentAt,40)||new Date().toISOString(),
      weddingDate:validDate(input.weddingDate)||"",
      startTime:text(input.startTime,10),
      location:text(input.location,240),
      km:number(input.km,0,5000),
      guests:number(input.guests,0,10000),
      interest:number(input.interest,0,100),
      tattoos:number(input.tattoos,0,10000),
      hoursNeeded:number(input.hoursNeeded,0,1000),
      packageId:text(input.packageId,50),
      packageName:text(input.packageName,80),
      basePrice:number(input.basePrice),
      total:number(input.total),
      deposit:number(input.deposit),
      extraHours:number(input.extraHours,0,1000),
      extraHourCost:number(input.extraHourCost),
      extraKm:number(input.extraKm,0,10000),
      extraKmCost:number(input.extraKmCost),
      includedHours:number(input.includedHours,0,1000),
      includedKm:input.includedKm===null?null:number(input.includedKm,0,10000),
      advice:text(input.advice,4000),
      notes:text(input.notes,10000),
      whatsappConsent:boolean(input.whatsappConsent),
      lastWhatsAppMessage:text(input.lastWhatsAppMessage,4000),
      lastWhatsAppAt:text(input.lastWhatsAppAt,40)
    }
  };
}

function rowToProposal(row){
  return {
    id:row.id,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
    status:row.status,
    ...row.data,
    history:Array.isArray(row.history)?row.history:[]
  };
}


const TATO_KNOWLEDGE=`
WEDDING TATTOO EXPERIENCE
- Servizio professionale di tatuaggi dal vivo durante matrimoni ed eventi.
- Solo persone maggiorenni possono tatuarsi.
- Sono esclusi viso, testa, collo, mani e dita.
- Non promettere mai la disponibilità di una data: deve verificarla lo staff.
- Non inventare prezzi, sconti, acconti, chilometri inclusi o condizioni.
- Per un preventivo preciso invita a usare il configuratore "Scopri i pacchetti".
- I tatuaggi sono piccoli, rapidi e scelti tra flash adatti all'evento.
- In media il configuratore stima circa 3 tatuaggi l'ora, ma è una previsione.
- Il servizio comprende allestimento professionale, materiali, assistenza e aftercare secondo il pacchetto.
- Igiene e sicurezza sono prioritarie; per questioni mediche specifiche indirizza a un professionista sanitario e allo staff.
- Contatti ufficiali: WhatsApp +39 347 705 0250; Tattoo Beauty Saloon, Via Torino 1A, Condove (TO).
`;

const TATO_INSTRUCTIONS=`
Sei Tato, il concierge digitale di Wedding Tattoo Experience.
Parli sempre in italiano, salvo richiesta esplicita in altra lingua.

PERSONALITÀ
- Amichevole, simpatico, elegante e rassicurante.
- Puoi usare una battuta leggera ogni tanto, mai in ogni risposta.
- Non essere infantile, invadente o insistente.
- Risposte brevi e facili da leggere, generalmente 2-6 frasi.
- Presentati come assistente digitale, mai come persona reale.

REGOLE IMPORTANTI
- Usa soltanto le informazioni fornite nel contesto del servizio.
- Non inventare prezzi, disponibilità, regole, condizioni o promesse.
- Non confermare date e non concludere contratti.
- Per preventivi definitivi, disponibilità, modifiche o decisioni di Elvis, passa allo staff.
- Non chiedere dati sanitari o dettagli sensibili.
- Se l'utente dichiara di essere minorenne, spiega gentilmente che il servizio tattoo è solo per maggiorenni.
- Se la domanda è medica o legale, dai solo informazioni generali e invita a rivolgersi a un professionista.
- Se l'utente vuole parlare con lo staff, indica WhatsApp +39 347 705 0250.
- Se chiede prezzi, spiega che dipendono da distanza, ore e configurazione e invitalo al configuratore.
- Se chiede "fa male?", rispondi con tono rassicurante: i flash sono piccoli e rapidi, la percezione è soggettiva.
- Se chiede qualcosa fuori tema, rispondi con simpatia e riporta la conversazione al matrimonio o al servizio.

CONTESTO DEL SERVIZIO:
${TATO_KNOWLEDGE}
`;

function cleanChatHistory(history){
  if(!Array.isArray(history)) return [];
  return history.slice(-10).map(item=>({
    role:item?.role==="assistant"?"assistant":"user",
    content:String(item?.content||"").slice(0,1200)
  })).filter(item=>item.content.trim());
}

function needsHumanHandoff(message,reply){
  const source=`${message} ${reply}`.toLowerCase();
  return [
    "disponibilità","bloccare la data","confermare la data","parlare con elvis",
    "contratto","sconto","prezzo definitivo","preventivo definitivo","reclamo"
  ].some(term=>source.includes(term));
}

function geminiReplyText(data){
  const parts=data?.candidates?.[0]?.content?.parts;
  if(!Array.isArray(parts)) return "";
  return parts
    .map(part=>typeof part?.text==="string"?part.text:"")
    .join("")
    .trim();
}

app.post("/api/chat",tatoLimiter,async(req,res,next)=>{
  try{
    const message=text(req.body?.message,1200);
    const sessionId=text(req.body?.sessionId,100)||crypto.randomUUID();
    const pageNumber=number(req.body?.page,1,100);
    const history=cleanChatHistory(req.body?.history);

    if(!message){
      return res.status(400).json({error:"Scrivi una domanda per Tato."});
    }

    if(!process.env.GEMINI_API_KEY){
      return res.status(503).json({
        error:"Assistente momentaneamente non configurato."
      });
    }

    const configuredModel=text(process.env.TATO_MODEL,80);
    const model=configuredModel.startsWith("gemini-")
      ? configuredModel
      : "gemini-2.5-flash";

    const endpoint=
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const contents=[
      ...history.map(item=>({
        role:item.role==="assistant"?"model":"user",
        parts:[{text:item.content}]
      })),
      {
        role:"user",
        parts:[{
          text:`Pagina catalogo visualizzata: ${pageNumber}. Domanda: ${message}`
        }]
      }
    ];

    const response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "x-goog-api-key":process.env.GEMINI_API_KEY,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        systemInstruction:{
          parts:[{text:TATO_INSTRUCTIONS}]
        },
        contents,
        generationConfig:{
          maxOutputTokens:420,
          temperature:0.65,
          topP:0.9
        }
      }),
      signal:AbortSignal.timeout(25000)
    });

    const data=await response.json().catch(()=>({}));

    if(!response.ok){
      console.error("Gemini API error:",{
        status:response.status,
        error:data?.error||data
      });

      if(response.status===429){
        return res.status(429).json({
          error:"Tato ha raggiunto temporaneamente il limite gratuito. Riprova tra poco."
        });
      }

      if(response.status===400||response.status===401||response.status===403){
        return res.status(503).json({
          error:"La configurazione di Tato deve essere verificata."
        });
      }

      return res.status(502).json({
        error:"Tato è momentaneamente impegnato."
      });
    }

    const reply=text(geminiReplyText(data),3000)||
      "Questa domanda merita una risposta precisa: preferisco passarla allo staff.";

    const handoff=needsHumanHandoff(message,reply);

    await pool.query(`
      INSERT INTO tato_conversations(
        session_id,user_message,assistant_reply,page_number,needs_human
      ) VALUES($1,$2,$3,$4,$5)
    `,[sessionId,message,reply,pageNumber,handoff]);

    res.json({
      reply,
      handoff,
      provider:"gemini",
      model,
      whatsapp:handoff
        ?"https://wa.me/393477050250?text="+encodeURIComponent(
          `Ciao, ho parlato con Tato e vorrei assistenza sulla mia richiesta: ${message}`
        )
        :null
    });
  }catch(error){
    if(error?.name==="TimeoutError"){
      return res.status(504).json({
        error:"Tato ci sta mettendo troppo. Riprova tra poco."
      });
    }
    next(error);
  }
});


app.post("/api/proposals",async(req,res,next)=>{
  try{
    const normalized=normalizeProposal(req.body);
    const event={
      id:crypto.randomUUID(),
      at:new Date().toISOString(),
      type:"create",
      text:"Nuova richiesta acquisita dal configuratore."
    };

    const result=await pool.query(`
      INSERT INTO proposals(id,status,data,history)
      VALUES($1,$2,$3::jsonb,$4::jsonb)
      ON CONFLICT(id) DO UPDATE SET
        status=EXCLUDED.status,
        data=proposals.data || EXCLUDED.data,
        updated_at=NOW(),
        history=proposals.history || $5::jsonb
      RETURNING *
    `,[
      normalized.id,
      normalized.status,
      JSON.stringify(normalized.data),
      JSON.stringify([event]),
      JSON.stringify([{
        ...event,
        id:crypto.randomUUID(),
        text:"Richiesta aggiornata dal configuratore."
      }])
    ]);

    res.status(201).json({proposal:rowToProposal(result.rows[0])});
  }catch(error){next(error)}
});

app.get("/api/admin/proposals",adminAuth,async(req,res,next)=>{
  try{
    const result=await pool.query(
      "SELECT * FROM proposals ORDER BY updated_at DESC"
    );
    res.json({proposals:result.rows.map(rowToProposal)});
  }catch(error){next(error)}
});

app.post("/api/admin/proposals",adminAuth,async(req,res,next)=>{
  try{
    const normalized=normalizeProposal({...req.body,id:null});
    const event={
      id:crypto.randomUUID(),
      at:new Date().toISOString(),
      type:"create",
      text:"Proposta creata dal CRM."
    };

    const result=await pool.query(`
      INSERT INTO proposals(id,status,data,history)
      VALUES($1,$2,$3::jsonb,$4::jsonb)
      RETURNING *
    `,[
      normalized.id,
      normalized.status,
      JSON.stringify(normalized.data),
      JSON.stringify([event])
    ]);

    res.status(201).json({proposal:rowToProposal(result.rows[0])});
  }catch(error){next(error)}
});

app.patch("/api/admin/proposals/:id",adminAuth,async(req,res,next)=>{
  try{
    const id=text(req.params.id,50);
    const found=await pool.query("SELECT * FROM proposals WHERE id=$1",[id]);
    if(!found.rowCount) return res.status(404).json({error:"Proposta non trovata"});

    const current=rowToProposal(found.rows[0]);
    const patch=req.body||{};
    const allowedData=[
      "names","phone","email","birthDate","weddingDate","location","notes",
      "whatsappConsent","lastWhatsAppMessage","lastWhatsAppAt",
      "nextFollowUp","depositPaid","contractSigned","lostReason","pdfSent",
      "source","flashReady","aftercareReady"
    ];

    const nextData={...found.rows[0].data};
    for(const key of allowedData){
      if(Object.prototype.hasOwnProperty.call(patch,key)){
        nextData[key]=patch[key];
      }
    }

    const nextStatus=text(patch.status,50)||current.status;
    const history=Array.isArray(found.rows[0].history)?found.rows[0].history:[];
    const historyText=text(patch.historyText,1000);

    if(historyText){
      history.unshift({
        id:crypto.randomUUID(),
        at:new Date().toISOString(),
        type:"update",
        text:historyText
      });
    }

    if(nextStatus!==current.status){
      history.unshift({
        id:crypto.randomUUID(),
        at:new Date().toISOString(),
        type:"status",
        text:`Stato modificato: ${current.status} → ${nextStatus}.`
      });
    }

    const result=await pool.query(`
      UPDATE proposals
      SET status=$2,data=$3::jsonb,history=$4::jsonb,updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `,[id,nextStatus,JSON.stringify(nextData),JSON.stringify(history)]);

    res.json({proposal:rowToProposal(result.rows[0])});
  }catch(error){next(error)}
});

app.delete("/api/admin/proposals/:id",adminAuth,async(req,res,next)=>{
  try{
    const result=await pool.query(
      "DELETE FROM proposals WHERE id=$1 RETURNING id",
      [text(req.params.id,50)]
    );
    if(!result.rowCount) return res.status(404).json({error:"Proposta non trovata"});
    res.json({ok:true});
  }catch(error){next(error)}
});

app.post("/api/admin/proposals/import",adminAuth,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const proposals=Array.isArray(req.body?.proposals)?req.body.proposals:[];
    if(proposals.length>2000){
      return res.status(400).json({error:"Backup troppo grande"});
    }

    await client.query("BEGIN");
    for(const raw of proposals){
      const normalized=normalizeProposal(raw,raw.id||null);
      const history=Array.isArray(raw.history)?raw.history:[];
      await client.query(`
        INSERT INTO proposals(id,status,data,history,created_at,updated_at)
        VALUES($1,$2,$3::jsonb,$4::jsonb,COALESCE($5::timestamptz,NOW()),COALESCE($6::timestamptz,NOW()))
        ON CONFLICT(id) DO UPDATE SET
          status=EXCLUDED.status,
          data=EXCLUDED.data,
          history=EXCLUDED.history,
          updated_at=EXCLUDED.updated_at
      `,[
        normalized.id,
        normalized.status,
        JSON.stringify(normalized.data),
        JSON.stringify(history),
        raw.createdAt||null,
        raw.updatedAt||null
      ]);
    }
    await client.query("COMMIT");
    res.json({ok:true,imported:proposals.length});
  }catch(error){
    await client.query("ROLLBACK");
    next(error);
  }finally{
    client.release();
  }
});

app.get("/api/health",async(req,res)=>{
  const result=await pool.query("SELECT NOW() AS now");
  res.json({ok:true,database:true,time:result.rows[0].now});
});


// Pannello amministrativo protetto.
// Percorsi disponibili:
//   /crm
//   /archivio
//   /crm-proposte.html
app.get(["/crm","/archivio"],adminAuth,(req,res)=>{
  res.sendFile(path.join(__dirname,"crm-proposte.html"));
});

app.get("/crm-proposte.html",adminAuth,(req,res)=>{
  res.sendFile(path.join(__dirname,"crm-proposte.html"));
});

app.use(express.static(__dirname,{
  extensions:["html"],
  index:"index.html",
  maxAge:process.env.NODE_ENV==="production"?"1h":0
}));

app.get("*",(req,res)=>{
  res.sendFile(path.join(__dirname,"index.html"));
});

app.use((error,req,res,next)=>{
  console.error(error);
  const status=error.status||500;
  res.status(status).json({
    error:status===500?"Errore interno del server":error.message
  });
});

initDb()
  .then(()=>{
    app.listen(PORT,()=>console.log(`WTE server attivo sulla porta ${PORT}`));
  })
  .catch(error=>{
    console.error("Errore inizializzazione database:",error);
    process.exit(1);
  });
