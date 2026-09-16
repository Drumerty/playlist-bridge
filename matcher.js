// ---------------------------------------------------------
// Playlist Bridge — track identity matcher
//
// Everything in this file answers one question: "is this search result
// actually the same recording as the track I asked for?"
//
// Without it, every search in the app took results[0] on faith, which is
// how karaoke versions, covers, sped-up edits and radio cuts end up in a
// transferred playlist. Five checks, in order of strength:
//
//   1. ISRC          — identifies a master recording. A match is decisive.
//   2. Variant tags  — (Live), (Karaoke), (Radio Edit) compared BOTH ways.
//   3. Primary artist— normalised, not string-equal.
//   4. Duration      — unit-safe, with tolerance.
//   5. Title         — after reissue noise is stripped.
//
// Exposed as window.PBMatch. No dependencies, no build step.
// ---------------------------------------------------------

(function (global) {
  "use strict";

  // =========================================================
  // TEXT
  // =========================================================

  function foldText(input) {
    if (!input) return "";
    return String(input)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")          // accents
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc'`´]/g, "")  // apostrophes: "don't" -> "dont"
      .replace(/[\u201c\u201d"]/g, "")
      .replace(/\s*&\s*/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    var curr = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (var k = 1; k <= b.length; k++) {
        var cost = a[i - 1] === b[k - 1] ? 0 : 1;
        curr[k] = Math.min(curr[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      var tmp = prev; prev = curr; curr = tmp;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    var fa = foldText(a), fb = foldText(b);
    if (!fa && !fb) return 1;
    if (!fa || !fb) return 0;
    if (fa === fb) return 1;
    return 1 - levenshtein(fa, fb) / Math.max(fa.length, fb.length);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  }

  // =========================================================
  // TITLE — reissue noise vs. version semantics
  //
  // These are OPPOSITE categories and must never be collapsed:
  //
  //   REISSUE NOISE describes the RELEASE.  "(2011 Remaster)", "[Deluxe]"
  //     -> strip it; the audio is the same master.
  //
  //   VARIANT TAGS describe the RECORDING.  "(Live)", "(Radio Edit)"
  //     -> keep it and compare it. Asking for the live cut and getting
  //        the studio take is just as wrong as the reverse.
  //
  // The app's old cleanTitleText() stripped "live" and "radio edit" as if
  // they were noise, which meant searching for a *different recording*
  // than the one requested and saving it under the original name.
  // =========================================================

  var REISSUE_TERMS = [
    "remaster", "remastered", "remastered version", "remasterizado",
    "deluxe", "deluxe edition", "super deluxe",
    "expanded", "expanded edition",
    "bonus track", "bonus",
    "anniversary edition", "anniversary",
    "reissue", "digital remaster",
    "special edition", "collectors edition",
    "explicit", "explicit version", "clean", "clean version", "album version",
    "official video", "official audio", "official music video",
    "official lyric video", "lyric video", "visualizer",
    "hd", "hq", "4k",
    "original motion picture soundtrack", "ost"
  ];

  var VARIANT_TERMS = [
    "live", "acoustic", "unplugged", "session",
    "remix", "rmx", "edit", "radio edit", "club mix", "extended", "extended mix",
    "instrumental", "a cappella", "acapella", "karaoke", "backing track",
    "cover", "tribute", "demo", "rehearsal",
    "sped up", "speed up", "slowed", "reverb", "nightcore", "8d audio",
    "piano version", "orchestral", "symphonic", "dub", "vip mix",
    "mono version", "stereo version", "single version", "alternate take"
  ];

  // Tags meaning "someone other than the original artist performed this",
  // or a derivative edit. Never acceptable unless explicitly requested.
  var HARD_VARIANT_TAGS = {
    "cover": 1, "tribute": 1, "karaoke": 1, "instrumental": 1,
    "backing track": 1, "sped up": 1, "speed up": 1, "slowed": 1,
    "reverb": 1, "nightcore": 1, "8d audio": 1
  };

  var REISSUE_ALT = REISSUE_TERMS
    .slice()
    .sort(function (a, b) { return b.length - a.length; })   // longest first
    .map(function (t) { return t.replace(/\s+/g, "\\s+"); })
    .join("|");

  // Keep the raw characters and the character class separate. Interpolating
  // a ready-made class into a negated class ("[^" + DASH + "]") produces a
  // broken nested class and silently disables all dash handling.
  var DASH_CHARS = "\\-\u2013\u2014";
  var DASH = "[" + DASH_CHARS + "]";
  var NOT_DASH = "[^" + DASH_CHARS + "]";

  function cleanTrackTitle(title) {
    if (!title) return "";
    var t = String(title);

    // Bracketed reissue noise: (2011 Remaster), [Official Video], [Deluxe]
    t = t.replace(
      new RegExp("\\s*[\\(\\[][^\\)\\]]*\\b(?:" + REISSUE_ALT + ")\\b[^\\)\\]]*[\\)\\]]", "gi"),
      ""
    );

    // Bare year brackets: (1997), [2004 Mix]
    t = t.replace(
      /\s*[\(\[]\s*(?:19|20)\d{2}(?:\s+(?:mix|version|recording|master))?\s*[\)\]]/gi,
      ""
    );

    // Dash-suffixed reissue noise: " - Remastered 2015", " - 2019 Mix"
    t = t.replace(
      new RegExp(
        "\\s+" + DASH + "\\s*" + NOT_DASH + "*\\b(?:" + REISSUE_ALT +
        "|(?:19|20)\\d{2}\\s+(?:mix|master|version))\\b" + NOT_DASH + "*$",
        "gi"
      ),
      ""
    );

    // Featuring clauses belong to the artist field, not the title.
    t = t.replace(/\s*[\(\[]\s*(?:feat|ft|featuring|with)\.?\s[^\)\]]*[\)\]]/gi, "");

    t = t.replace(/\s{2,}/g, " ").replace(new RegExp("\\s*" + DASH + "\\s*$"), "").trim();
    return t || String(title);   // never return empty
  }

  // A variant word only counts in a VERSION-MARKER POSITION: bracketed,
  // after a dash, or (for "live") followed by at/from/in/on. Without this,
  // a plain substring blacklist rejects "Cover Me", "Live and Let Die"
  // and "Undercover Martyn".
  function extractVariantTags(title) {
    var found = {};
    if (!title) return found;
    var folded = foldText(title);

    for (var i = 0; i < VARIANT_TERMS.length; i++) {
      var ft = foldText(VARIANT_TERMS[i]);
      if (!ft) continue;
      if (new RegExp("\\b" + escapeRe(ft) + "\\b").test(folded)) found[ft] = 1;
    }

    Object.keys(found).forEach(function (tag) {
      var p = escapeRe(tag);
      var inBrackets = new RegExp("[\\(\\[][^\\)\\]]*\\b" + p + "\\b[^\\)\\]]*[\\)\\]]", "i");
      var afterDash = new RegExp(DASH + "\\s*" + NOT_DASH + "*\\b" + p + "\\b", "i");
      var livePhrase = tag === "live" && /\blive\s+(?:at|from|in|on)\b/i.test(title);
      if (!inBrackets.test(title) && !afterDash.test(title) && !livePhrase) {
        delete found[tag];
      }
    });

    return found;
  }

  function compareVariants(sourceTags, candTags) {
    var s = Object.keys(sourceTags || {});
    var c = Object.keys(candTags || {});

    var unwanted = c.filter(function (t) { return !sourceTags[t] && HARD_VARIANT_TAGS[t]; });
    if (unwanted.length) return { ok: false, reason: "unrequested " + unwanted.join("/") };

    var missing = s.filter(function (t) { return !candTags[t]; });
    if (missing.length) return { ok: false, reason: "missing " + missing.join("/") };

    var extra = c.filter(function (t) { return !sourceTags[t]; });
    if (extra.length) return { ok: false, reason: "extra " + extra.join("/") };

    return { ok: true };
  }

  // =========================================================
  // ARTIST
  //
  // Raw equality (a.toLowerCase() === b.toLowerCase()) is too strict and
  // produces constant false negatives: Beyoncé/Beyonce, The Beatles/
  // Beatles, "Tyler, The Creator"/"Tyler the Creator", Drake/"Drake feat.
  // Rihanna". The rule enforced instead: the SOURCE's primary artist must
  // appear in the candidate's credits. Extra featured artists on the
  // candidate side are fine — services disagree constantly about whether
  // a "feat." lives in the title or the artist field.
  // =========================================================

  // "/" is deliberately NOT a delimiter — it appears inside legitimate
  // artist names (AC/DC) far more often than it separates them.
  var ARTIST_SPLIT =
    /\s*(?:,|&|\+|\bx\b|\bvs\.?\b|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b)\s*/i;

  function parseArtists(field) {
    var raw = [];
    if (Object.prototype.toString.call(field) === "[object Array]") {
      raw = field.map(function (a) { return typeof a === "string" ? a : (a && a.name); })
                 .filter(Boolean);
    } else if (field) {
      raw = [String(field)];
    }
    var out = [];
    raw.forEach(function (name) {
      String(name).split(ARTIST_SPLIT).forEach(function (part) {
        var folded = foldText(part).replace(/^the\s+/, "");
        if (folded) out.push(folded);
      });
    });
    return out;
  }

  function compareArtists(sourceArtists, candidateArtists, nearMatch) {
    nearMatch = nearMatch || 0.9;
    var src = parseArtists(sourceArtists);
    var cand = parseArtists(candidateArtists);
    if (!src.length || !cand.length) return 0;

    // Services tokenise credits inconsistently: "Tyler, The Creator" splits
    // on the comma while "Tyler the Creator" does not. Comparing only
    // token-to-token misses those, so also test whole-word presence in the
    // joined credit string.
    var candJoined = cand.join(" ");
    function present(name) {
      for (var i = 0; i < cand.length; i++) {
        if (cand[i] === name || similarity(cand[i], name) >= nearMatch) return true;
      }
      return new RegExp("\\b" + escapeRe(name) + "\\b").test(candJoined);
    }

    if (!present(src[0])) return 0;

    var seen = {}, overlap = 0, unionCount = 0, all = {};
    src.forEach(function (s) { if (!seen[s]) { seen[s] = 1; if (present(s)) overlap++; } });
    src.concat(cand).forEach(function (n) { if (!all[n]) { all[n] = 1; unionCount++; } });

    return 0.75 + 0.25 * (unionCount ? overlap / unionCount : 0);
  }

  // Lead artist only, for display and for building search queries.
  function primaryArtist(artist) {
    var first = String(artist || "").split(ARTIST_SPLIT)[0].trim();
    return first || String(artist || "");
  }

  // =========================================================
  // DURATION
  //
  // Services disagree on units, and mixing them up is the single most
  // common cause of false rejections:
  //
  //   Spotify      duration_ms    milliseconds
  //   Deezer       duration       SECONDS
  //   MusicBrainz  length         milliseconds
  //   YouTube      "PT4M7S"       ISO-8601 duration
  //
  // Conversion happens here and nowhere else.
  // =========================================================

  function toMilliseconds(value, unit) {
    if (value === null || value === undefined || value === "") return null;

    if (typeof value === "string") {
      // ISO-8601 (YouTube contentDetails.duration): PT1H2M33S
      var iso = value.match(/^P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
      if (iso) {
        return ((+iso[1] || 0) * 3600 + (+iso[2] || 0) * 60 + (+iso[3] || 0)) * 1000;
      }
      // "4:07" or "1:02:33"
      if (value.indexOf(":") !== -1) {
        var parts = value.split(":").map(Number);
        if (parts.some(isNaN)) return null;
        return parts.reduce(function (acc, p) { return acc * 60 + p; }, 0) * 1000;
      }
    }

    var n = Number(value);
    if (isNaN(n)) return null;
    return unit === "s" ? n * 1000 : n;
  }

  // Tapered rather than a hard cliff: cross-service masters routinely
  // differ by 1-2 s from silence trimming and encoder padding.
  //   <= tolerance      -> 1
  //   >= 2 * tolerance  -> 0
  // Returns null when either side is unknown, so callers can redistribute
  // the weight instead of treating unknown as disagreement.
  // longerToleranceMs applies only when the CANDIDATE runs longer than the
  // source. YouTube needs this: an official music video legitimately
  // carries 30-60s of intro/outro around the same recording, while a
  // candidate that's SHORTER is still a radio edit or a clip and stays
  // tightly bounded. Defaults to toleranceMs, i.e. symmetric.
  function durationScore(srcMs, candMs, toleranceMs, longerToleranceMs) {
    toleranceMs = toleranceMs || 3000;
    if (srcMs == null || candMs == null) return null;

    var limit = (candMs > srcMs && longerToleranceMs) ? longerToleranceMs : toleranceMs;
    var diff = Math.abs(srcMs - candMs);
    if (diff <= limit) return 1;
    if (diff >= limit * 2) return 0;
    return 1 - (diff - limit) / limit;
  }

  function formatDuration(ms) {
    if (ms == null) return "?:??";
    var total = Math.round(ms / 1000);
    var m = Math.floor(total / 60);
    var s = String(total % 60);
    return m + ":" + (s.length < 2 ? "0" + s : s);
  }

  // =========================================================
  // ISRC
  //
  // Asymmetric on purpose:
  //   MATCH    -> definitive, accept immediately.
  //   MISMATCH -> weak evidence. Labels re-register the same recording
  //               with new codes per territory and per reissue, so a
  //               mismatch alone never rejects.
  // =========================================================

  var ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;

  function normalizeIsrc(isrc) {
    if (!isrc) return null;
    var clean = String(isrc).toUpperCase().replace(/[^A-Z0-9]/g, "");
    return ISRC_RE.test(clean) ? clean : null;
  }

  // =========================================================
  // SCORING
  //
  // Hard rejects are reserved for unambiguous contradictions; everything
  // else is scored and thresholded. A pure filter chain returns "no match"
  // so often that you end up loosening thresholds until wrong versions
  // slip through anyway.
  // =========================================================

  var WEIGHTS = { title: 0.45, artist: 0.35, duration: 0.20 };

  var DEFAULTS = {
    toleranceMs: 3000,
    titleFloor: 0.80,
    minScore: 0.82,
    confidentAt: 0.92,
    ambiguityGap: 0.03
  };

  function scoreCandidate(source, candidate, opts) {
    opts = opts || {};
    var cfg = {
      toleranceMs: opts.toleranceMs != null ? opts.toleranceMs : DEFAULTS.toleranceMs,
      longerToleranceMs: opts.longerToleranceMs != null ? opts.longerToleranceMs : null,
      titleFloor: opts.titleFloor != null ? opts.titleFloor : DEFAULTS.titleFloor,
      confidentAt: opts.confidentAt != null ? opts.confidentAt : DEFAULTS.confidentAt,
      minScore: opts.minScore != null ? opts.minScore : DEFAULTS.minScore
    };
    var reasons = [];

    // Hard accept: identical ISRC is definitive.
    var srcIsrc = normalizeIsrc(source.isrc);
    var candIsrc = normalizeIsrc(candidate.isrc);
    if (srcIsrc && candIsrc && srcIsrc === candIsrc) {
      return { score: 1, verdict: "exact", reasons: ["ISRC match"] };
    }
    if (srcIsrc && candIsrc) reasons.push("different ISRC (not decisive)");

    // Hard reject: primary artist missing.
    var artistScore = compareArtists(
      source.artists || source.artist,
      candidate.artists || candidate.artist
    );
    if (artistScore === 0) {
      return { score: 0, verdict: "reject", reasons: ["different artist"] };
    }

    // Hard reject: asymmetric variant tags.
    var variant = compareVariants(
      extractVariantTags(source.title),
      extractVariantTags(candidate.title)
    );
    if (!variant.ok) {
      return { score: 0, verdict: "reject", reasons: [variant.reason] };
    }

    // Hard reject: title too distant.
    //
    // Some sources embed the artist in the title ("The Weeknd - Blinding
    // Lights" on YouTube). Those adapters supply titleAlts with the
    // stripped forms; the best of them counts, while variant tags above
    // are still read from the FULL title so "(Karaoke)" can't hide in a
    // discarded prefix.
    var titleForms = [candidate.title].concat(candidate.titleAlts || []);
    var titleScore = 0;
    for (var ti = 0; ti < titleForms.length; ti++) {
      if (!titleForms[ti]) continue;
      var s = similarity(cleanTrackTitle(source.title), cleanTrackTitle(titleForms[ti]));
      if (s > titleScore) titleScore = s;
    }
    if (titleScore < cfg.titleFloor) {
      return { score: 0, verdict: "reject", reasons: ["different title"] };
    }

    // Hard reject: duration structurally different.
    var dScore = durationScore(
      source.durationMs, candidate.durationMs, cfg.toleranceMs, cfg.longerToleranceMs
    );
    if (dScore === 0) {
      var delta = (candidate.durationMs - source.durationMs) / 1000;
      return {
        score: 0,
        verdict: "reject",
        reasons: [(delta > 0 ? "longer by " : "shorter by ") + Math.abs(delta).toFixed(0) + "s"]
      };
    }

    var score;
    if (dScore == null) {
      reasons.push("length unknown");
      score = (titleScore * WEIGHTS.title + artistScore * WEIGHTS.artist) /
              (WEIGHTS.title + WEIGHTS.artist);
    } else {
      score = titleScore * WEIGHTS.title +
              artistScore * WEIGHTS.artist +
              dScore * WEIGHTS.duration;
    }

    var verdict = score >= cfg.confidentAt ? "confident"
                : score >= cfg.minScore ? "probable"
                : "uncertain";

    return { score: score, verdict: verdict, reasons: reasons };
  }

  // Returns null rather than guessing. A miss is cheaper to fix than a
  // wrong file that quietly enters a playlist.
  function pickBestMatch(source, candidates, opts) {
    opts = opts || {};
    var minScore = opts.minScore != null ? opts.minScore : DEFAULTS.minScore;
    var gap = opts.ambiguityGap != null ? opts.ambiguityGap : DEFAULTS.ambiguityGap;

    var ranked = (candidates || []).map(function (c) {
      var r = scoreCandidate(source, c, opts);
      return { candidate: c, score: r.score, verdict: r.verdict, reasons: r.reasons };
    }).sort(function (a, b) { return b.score - a.score; });

    var best = ranked[0];
    if (!best || best.score < minScore) {
      return {
        match: null,
        score: best ? best.score : 0,
        verdict: "no-match",
        reasons: best ? best.reasons : ["no candidates"],
        ranked: ranked
      };
    }

    var runnerUp = ranked[1];
    var ambiguous = best.verdict !== "exact" && runnerUp && runnerUp.score > 0 &&
                    (best.score - runnerUp.score) < gap;

    return {
      match: best.candidate,
      score: best.score,
      verdict: ambiguous ? "ambiguous" : best.verdict,
      reasons: best.reasons,
      ranked: ranked
    };
  }

  // =========================================================
  // ADAPTERS — unit conversion happens here, nowhere else.
  // =========================================================

  var adapters = {
    spotify: function (t) {
      if (!t) return null;
      return {
        id: t.id,
        title: t.name,
        artists: (t.artists || []).map(function (a) { return a.name; }).filter(Boolean),
        album: t.album && t.album.name,
        durationMs: toMilliseconds(t.duration_ms, "ms"),
        isrc: t.external_ids && t.external_ids.isrc,
        raw: t
      };
    },

    // Deezer reports SECONDS.
    deezer: function (t) {
      if (!t) return null;
      return {
        id: t.id,
        title: t.title_short || t.title,
        artists: [t.artist && t.artist.name].filter(Boolean),
        album: t.album && t.album.title,
        durationMs: toMilliseconds(t.duration, "s"),
        isrc: t.isrc,
        url: t.link,
        raw: t
      };
    },

    musicbrainz: function (r) {
      if (!r) return null;
      var credits = (r["artist-credit"] || []).map(function (ac) {
        return (ac.artist && ac.artist.name) || ac.name;
      }).filter(Boolean);
      return {
        id: r.id,
        title: r.title,
        artists: credits,
        durationMs: toMilliseconds(r.length, "ms"),
        isrc: (r.isrcs || [])[0],
        raw: r
      };
    },

    // YouTube search results carry no duration or artist field — the
    // channel title is the closest thing to an artist, and the video
    // title usually contains "Artist - Title". Duration comes from a
    // separate videos?part=contentDetails call (see app.js).
    youtube: function (item, durationIso) {
      if (!item) return null;
      var sn = item.snippet || {};
      var videoTitle = sn.title || "";
      var channel = (sn.channelTitle || "").replace(/\s*-\s*Topic$/i, "");
      var dashIdx = videoTitle.indexOf(" - ");
      var guessedArtist = dashIdx > 0 ? videoTitle.slice(0, dashIdx) : "";
      var afterDash = dashIdx > 0 ? videoTitle.slice(dashIdx + 3) : "";
      return {
        id: (item.id && item.id.videoId) || item.id,
        title: videoTitle,
        // "The Weeknd - Blinding Lights" should still match a source title
        // of "Blinding Lights", so offer the post-dash form as an
        // alternative. Variant tags are still read from the full title.
        titleAlts: [afterDash].filter(Boolean),
        // Match against the channel name AND anything before the dash;
        // "Rick Astley - Never Gonna Give You Up" on a random channel
        // still credits the artist in the title.
        artists: [channel, guessedArtist].filter(Boolean),
        durationMs: toMilliseconds(durationIso, "ms"),
        raw: item
      };
    },

    itunes: function (r) {
      if (!r) return null;
      return {
        id: r.trackId,
        title: r.trackName,
        artists: [r.artistName].filter(Boolean),
        album: r.collectionName,
        durationMs: toMilliseconds(r.trackTimeMillis, "ms"),
        raw: r
      };
    }
  };

  // Build a search query: strip reissue noise, keep variant tags (they
  // identify the recording you actually want), reduce to primary artist,
  // drop punctuation that hurts literal matching.
  function buildSearchQuery(track) {
    var title = cleanTrackTitle(track.title);
    var artist = primaryArtist(track.artist || (track.artists && track.artists[0]));
    return (artist + " " + title)
      .replace(/\./g, "")
      .replace(/-/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  global.PBMatch = {
    foldText: foldText,
    similarity: similarity,
    cleanTrackTitle: cleanTrackTitle,
    extractVariantTags: extractVariantTags,
    compareVariants: compareVariants,
    parseArtists: parseArtists,
    compareArtists: compareArtists,
    primaryArtist: primaryArtist,
    toMilliseconds: toMilliseconds,
    durationScore: durationScore,
    formatDuration: formatDuration,
    normalizeIsrc: normalizeIsrc,
    scoreCandidate: scoreCandidate,
    pickBestMatch: pickBestMatch,
    buildSearchQuery: buildSearchQuery,
    adapters: adapters,
    DEFAULTS: DEFAULTS,
    REISSUE_TERMS: REISSUE_TERMS,
    VARIANT_TERMS: VARIANT_TERMS,
    HARD_VARIANT_TAGS: HARD_VARIANT_TAGS
  };
})(window);
