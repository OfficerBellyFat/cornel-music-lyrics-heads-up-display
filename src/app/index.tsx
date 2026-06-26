import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, StyleSheet, Text, View } from "react-native";
import { PermissionsAndroid, Platform, NativeModules, DeviceEventEmitter } from "react-native";
const { MediaSessionModule } = NativeModules;

export default function HomeScreen() {
  interface LyricLine {
    timeInMs: number;
    text: string;
  }

  const flatListRef = useRef<FlatList>(null);
  const itemHeights = useRef<Record<number, number>>({});
  const listHeight = useRef(0);
  const currentTrackRef = useRef("");
  const lastKnownPosition = useRef({
    positionMs: 0,
    timestamp: Date.now(),
    isPlaying: false,
  });

  const [plainLyrics, setPlainLyrics] = useState("");
  const [syncedLyrics, setSyncedLyrics] = useState("");
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([]);
  const [positionMs, setPositionMs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artistName, setArtistName] = useState("");
  const [trackName, setTrackName] = useState("");
  const [getApiRoute, setGetApiRoute] = useState("");
  const [musicPlaying, setMusicPlaying] = useState(false);

  const activeLineIndex = useMemo(() => {
    return parsedLyrics.reduce((last, line, i) => {
      return line.timeInMs <= positionMs ? i : last;
    }, 0);
  }, [positionMs, parsedLyrics]);

  const setOrientationToLandscape = async () => {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
  };

  const assembleGETLink = (trackName: string, artistName: string) => {
    const formattedTrackName = encodeURI(trackName).replace(/\//gi, "%2F");
    const formattedArtistName = encodeURI(artistName).replace(/\//gi, "%2F");

    console.log(formattedTrackName);
    console.log(formattedArtistName);

    setGetApiRoute(
      "https://lrclib.net/api/get?track_name=" + formattedTrackName + "&artist_name=" + formattedArtistName,
    );
  };

  const parseSyncedLyrics = (rawString: string) => {
    console.log(rawString);

    const lines = rawString.trim().split(/\r?\n/);
    console.log("Lyrics parsed.");

    return lines
      .map((line: string) => {
        const match = line.trim().match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
        if (!match) return null;
        const [, min, sec, ms, text] = match;
        const timeInMs = +min * 60 * 1000 + +sec * 1000 + +ms.padEnd(3, "0");
        return { timeInMs, text: text.trim() } as LyricLine;
      })
      .filter((x): x is LyricLine => x !== null);
  };

  const fetchAPIData = async () => {
    console.log(trackName);
    if (!getApiRoute) return;

    setLoading(true);
    setError(null);
    try {
      console.log("fetching API data:", getApiRoute);
      const result = await fetch(getApiRoute);
      const data = await result.json();
      setPlainLyrics(data.plainLyrics);
      setSyncedLyrics(data.syncedLyrics);

      const parsed = parseSyncedLyrics(data.syncedLyrics ?? "");
      setParsedLyrics(parsed);
      setPositionMs(lastKnownPosition.current.positionMs);
      console.log("parsed lyrics: ", parsed);
    } catch (e) {
      setError(String(e));
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  // debug music change
  const changeMusic = () => {
    setTrackName("Bad Day");
    setArtistName("Daniel Powter");
  };

  const androidPermissionRequest = async () => {
    if (Platform.OS === "android" && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
  };

  const checkNotificationPermission = async () => {
    const granted = await MediaSessionModule.isNotificationAccessGranted();
    if (!granted) {
      MediaSessionModule.openNotificationSettings();
    }
  };

  // app setup on runtime
  useEffect(() => {
    setOrientationToLandscape();
    androidPermissionRequest();
    checkNotificationPermission();
    // setTrackName("shoot to thrill"); //TODO debugging
    // setArtistName("AC/DC"); //TODO debugging
  }, []);

  // listen to service emits
  useEffect(() => {
    const mediaSubscription = DeviceEventEmitter.addListener(
      "OnMediaStateChanged",
      (event: { title: string; artist: string; positionMs: number; isPlaying: boolean }) => {
        lastKnownPosition.current = {
          positionMs: event.positionMs,
          timestamp: Date.now(),
          isPlaying: event.isPlaying,
        };

        setMusicPlaying(event.isPlaying);

        if (event.title !== currentTrackRef.current) {
          currentTrackRef.current = event.title;
          setTrackName(event.title);
          setArtistName(event.artist);
        }
      },
    );

    return () => mediaSubscription.remove();
  }, []);

  // user returning from system settings
  useEffect(() => {
    const resumeSubscription = DeviceEventEmitter.addListener("OnAppResume", async () => {
      const granted = await MediaSessionModule.isNotificationAccessGranted();
      console.log("permission granted: " + granted);
    });

    return () => resumeSubscription.remove();
  }, []);

  // assemble link
  useEffect(() => {
    if (!trackName || !artistName) return;
    assembleGETLink(trackName, artistName);
  }, [trackName, artistName]);

  // fetch API data
  useEffect(() => {
    fetchAPIData();
  }, [getApiRoute]);

  // auto scroll
  useEffect(() => {
    if (!flatListRef.current || parsedLyrics.length === 0) return;

    let offset = 0;
    for (let i = 0; i < activeLineIndex; i++) {
      offset += itemHeights.current[i] ?? 0;
    }

    const activeItemHeight = itemHeights.current[activeLineIndex] ?? 0;
    const centeredOffset = offset - listHeight.current / 2 + activeItemHeight / 2;

    flatListRef.current.scrollToOffset({
      offset: Math.max(0, centeredOffset),
      animated: true,
    });
  }, [activeLineIndex]);

  // mock timer
  // useEffect(() => {
  //   const timer = setInterval(() => {
  //     setPositionMs((prev) => prev + 500);
  //   }, 100);

  //   return () => clearInterval(timer);
  // }, []);

  // position interpolation timer
  useEffect(() => {
    if (!musicPlaying) return;

    const timer = setInterval(() => {
      const { positionMs: last, timestamp, isPlaying } = lastKnownPosition.current;
      if (isPlaying) {
        setPositionMs(last + (Date.now() - timestamp));
      }
    }, 250);

    return () => clearInterval(timer);
  }, [musicPlaying]);

  return (
    <View style={styles.mainContainer}>
      <View style={styles.lyricsContainer}>
        {
        //   !musicPlaying ? (
        //   <View style={{ justifyContent: "center", alignItems: "center" }}>
        //     <Text style={styles.mainText}>No music is currently playing.</Text>
        //     <View style={styles.reverseXScale}>
        //       <Text style={styles.mainText}>No music is currently playing.</Text>
        //     </View>
        //   </View>
        // ) :
          loading ? (
          <View style={{ justifyContent: "center", alignItems: "center" }}>
            <Text style={styles.mainText}>Loading Lyrics…</Text>
            <View style={styles.reverseXScale}>
              <Text style={styles.mainText}>Loading Lyrics…</Text>
            </View>
          </View>
        ) : error ? (
          <Text style={[styles.mainText, { color: "red" }]}>{error}</Text>
        ) : parsedLyrics.length === 0 ? (
          <View style={{ justifyContent: "center", alignItems: "center" }}>
            <Text style={styles.mainText}>No synced lyrics found.</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={parsedLyrics}
            keyExtractor={(_: any, i: any) => i.toString()}
            initialNumToRender={parsedLyrics.length}
            onLayout={(e) => {
              listHeight.current = e.nativeEvent.layout.height;
            }}
            renderItem={({ item, index }) => (
              <View style={styles.reverseXScale}>
                <Text
                  onLayout={(e) => {
                    itemHeights.current[index] = e.nativeEvent.layout.height;
                  }}
                  style={index === activeLineIndex ? styles.lyricsText : styles.inactiveLyricsText}
                >
                  {item.text}
                </Text>
              </View>
            )}
          />
        )}
        {/* <Text style={styles.lyricsText}>
          {plainLyrics}
        </Text> */}
      </View>
      <Button title="Change Music" onPress={changeMusic}></Button>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    justifyContent: "center",
    flexDirection: "column",
    backgroundColor: "black",
    height: "100%",
  },

  lyricsContainer: {
    marginLeft: 60,
    marginRight: 60,
    marginTop: 20,
  },

  mainText: {
    color: "white",
    fontSize: 30,
  },

  lyricsText: {
    color: "#90ee90",
    fontSize: 60,
  },

  inactiveLyricsText: {
    color: "#90ee907e",
    fontSize: 50,
    marginTop: 10,
  },

  reverseXScale: {
    transform: [{ scaleX: -1 }],
  },
});
