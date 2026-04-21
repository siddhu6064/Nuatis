# Website VERTICAL_DATA patch — Phase 10 vertical refresh

Website files live outside the monorepo (deployed separately to Cloudflare). Apply these updates manually to:

- `/home/claude/index.html` — readable/pretty format (keep as-is)
- `/home/claude/why.html` — minified format (preserve single-line per key)

Only the `fields`, `stages`, and `maya` arrays change. Keep `emo`, `name`, `outcome`, `upgrades`, `integrations`, `compliance`, modal CSS, modal HTML, and `openV()` untouched.

---

## Per-vertical replacement values

### dental

```js
fields: ["Date of birth","Last visit date","Next recall date","Allergies","Chief complaint","Preferred dentist","Preferred appointment time","X-ray consent on file"],
stages: ["New inquiry","Consultation scheduled","Treatment plan presented","Active patient","Recall due","Inactive / lapsed"],
maya:   ["New patient appointment request","Emergency toothache triage","Reschedule or cancel","Recall reminder response"],
```

### medical

```js
fields: ["Date of birth","Primary physician","Current conditions","Current medications","Allergies","Emergency contact","Last visit date","Next follow-up date"],
stages: ["New patient","Intake scheduled","Consultation","Active patient","Follow-up scheduled","Inactive / lapsed"],
maya:   ["New patient intake","Appointment booking","Prescription refill request","Urgent symptom triage"],
```

### veterinary

```js
fields: ["Pet name","Species","Breed","Pet date of birth","Weight (lbs)","Microchip number","Spayed / neutered","Vaccination history"],
stages: ["New inquiry","Consultation booked","Under care","Recovery","Annual recall","Active pet","Inactive"],
maya:   ["Checkup and vaccination booking","After-hours emergency triage","Boarding and grooming","Annual wellness recall"],
```

### salon

```js
fields: ["Preferred stylist","Hair type","Hair length","Colour formula","Last service date","Birthday","Product preferences","Loyalty tier"],
stages: ["New inquiry","Consultation","Service booked","Regular client","At risk","Lapsed"],
maya:   ["Color, cut, treatment booking","Reschedule or cancel","Gift card purchases","Last-minute cancellation fill"],
```

### restaurant

```js
fields: ["Usual party size","Seating preference","Dietary restrictions","Favorite occasions","Preferred server","Favorite dishes","Loyalty tier","Last visit date"],
stages: ["Inquiry","Reservation confirmed","Arrived","Past guest","VIP regular","No-show"],
maya:   ["Table reservation","Large-party / private event","Hours / menu / dietary questions","Reservation change or cancellation"],
```

### contractor

```js
fields: ["Project type","Scope of work","Property address","Property type","Budget range","Timeline / urgency","Bid amount ($)","Bid status"],
stages: ["New lead","Site visit scheduled","Estimate sent","Accepted","In progress","Completed","Lost"],
maya:   ["New project / estimate inquiry","Site visit scheduling","Project status update","Warranty or punch-list items"],
```

### law_firm

```js
fields: ["Case type","Matter number","Conflict check status","Statute of limitations date","Retainer status","Retainer amount ($)","Court jurisdiction","Case description"],
stages: ["New inquiry","Conflict check","Consultation scheduled","Consultation complete","Retained","Active matter","Closed / declined"],
maya:   ["New client intake","Consultation scheduling","Retainer or billing questions","Urgent matter to attorney"],
```

### real_estate

```js
fields: ["Client type","Budget min ($)","Budget max ($)","Preferred areas","Bedrooms (min)","Property types","Timeline","Pre-approval status"],
stages: ["New lead","Showing scheduled","Actively touring","Offer made","Under contract","Closed won","Closed lost"],
maya:   ["Listing and showing inquiries","Pre-qualification questions","Open house RSVPs","New seller listing inquiry"],
```

### sales_crm

```js
fields: ["Company","Job title","Industry","Company size","Deal value ($)","Decision timeline","Lead source","Lead score"],
stages: ["New lead","Qualified","Demo scheduled","Proposal sent","Negotiation","Closed won","Closed lost"],
maya:   ["Inbound sales qualification","Demo scheduling","Pricing and package questions","Renewal or expansion"],
```

---

## why.html (minified)

Concatenate each vertical's three arrays on a single line. Example for dental:

```js
dental:{emo:"🦷",name:"Dental practice",fields:["Date of birth","Last visit date","Next recall date","Allergies","Chief complaint","Preferred dentist","Preferred appointment time","X-ray consent on file"],stages:["New inquiry","Consultation scheduled","Treatment plan presented","Active patient","Recall due","Inactive / lapsed"],maya:["New patient appointment request","Emergency toothache triage","Reschedule or cancel","Recall reminder response"],outcome:"…unchanged…",upgrades:"…unchanged…",integrations:"…unchanged…",compliance:"…unchanged…"},
```

Preserve existing values for `outcome`, `upgrades`, `integrations`, `compliance`.

## Verification after deploy

1. Hard-refresh `/index.html` and `/why.html` (bypass cache).
2. Click each vertical popup trigger.
3. Confirm new field + stage + Maya intent labels render.
4. Confirm `integrations` and `compliance` sections unchanged.
5. No console errors; modal open/close still works.
