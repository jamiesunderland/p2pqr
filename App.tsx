import { useCallback, useState, useEffect, useMemo } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Camera, CameraType } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';
import * as Brightness from 'expo-brightness';
import { SafeAreaView } from "react-native-safe-area-context";
import QRCode from 'react-native-qrcode-svg';
import * as Sharing from "expo-sharing";

const readFileAsBinary = async (fileUri: string) => {
  try {
    const fileContent = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return fileContent;
  } catch (error) {
    console.error("Failed to read file", error);
    return null;
  }
};

const CHUNK_SIZE = 128;

interface Document {
  id: string;
  size: number;
  name: string;
  mimeType: string;
  uri: string;
}

interface Message {
  qr: "p2pqr",
  type: string;
  payload: any;
}

export default function App() {

  const [action, setAction] = useState<"none"|"selected_file"|"receive"|"send">("none")
  const [document, setDocument] = useState<Document|null>(null);
  const [outgoingMessages, setOutgoingMessages] = useState<Array<Message>>([])
  const [outgoingIndex, setOutgoingIndex] = useState(0);
  const [incomingId, setIncomingId] = useState(null);
  const [incomingLastIndex, setIncomingLastIndex] = useState(-1);
  const [incomingMessagesLength, setIncomingMessagesLength] = useState(-1);
  const [incomingMessages, setIncomingMessages] = useState<Array<Message>>([]);

  const onStartReceiving = useCallback(() => {
      setIncomingLastIndex(-1);
      setIncomingMessagesLength(-1);
      setIncomingMessages([]);
      setAction("receive");
  }, [])

  const pickDocument = useCallback(async () => {
    let result = await DocumentPicker.getDocumentAsync({});
    if (!result.canceled && result?.assets[0]) {
      setDocument({
        id: Math.random().toString(),
        size: result.assets[0].size as number,
        name: result.assets[0].name,
        mimeType: result.assets[0].mimeType as string,
        uri: result.assets[0].uri,
      });
      setAction("selected_file");
    }
  }, []);

  const onStartSendMode = useCallback(async () => {
    if (!document?.uri) {
      return;
    }
    const base64 = await readFileAsBinary(document?.uri);
    if (!base64) {
      Alert.alert("could not create messages")
      return;
    }
    const chunks: Array<string> = [];
    for (let i = 0; i < base64?.length; i += CHUNK_SIZE) {
      chunks.push(base64.substr(i, CHUNK_SIZE));
    }
    const messages: Array<Message> = [{
      type: "send_init",
      qr: "p2pqr",
      payload: {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
        totalChunks: chunks.length + 1
      }
    }];

    for (let i = 0; i < chunks.length; ++i) {
      messages.push({
        type: "send_chunk",
        qr: "p2pqr",
        payload: {
          id: document.id,
          chunkIndex: i,
          data: chunks[i]
        }
      })
    }

    setOutgoingIndex(0);
    setOutgoingMessages(messages);
    setAction("send");
  }, [document]);

  const [hasCameraPermission, setHasCameraPermission] = useState(false);

  const requestCameraPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    if (!status) {
      setHasCameraPermission(false);
      return;
    }
    setHasCameraPermission(status === 'granted');
  };

  useEffect(() => {
    requestCameraPermission();
  }, []);

  const handleAck = useCallback((scan: {data: string}) => {
    try {
      const data = JSON.parse(scan?.data);
      if (data["qr"] == "p2pqr" && data["type"] == "received_chunk" && data["payload"]["id"] == document?.id) {
        if (data["payload"]["chunkIndex"] < outgoingMessages.length - 1) {
          setOutgoingIndex(data["payload"]["chunkIndex"] + 1)
        }
      }
      if (data["qr"] == "p2pqr" && data["type"] == "receive_done" && data["payload"]["id"] == document?.id) {
        Alert.alert("MESSAGE RECEIVED");
        setAction("none");
      }
    } catch(e) {

    }
  }, [document, outgoingMessages]);

  const handleMessage = useCallback((scan: {data: string}) => {
    try {
      const data = JSON.parse(scan?.data);
      if (incomingLastIndex == -1) {
        if (data["qr"] == "p2pqr" && data["type"] == "send_init" && data["payload"]["id"]) {
          setIncomingId(data["payload"]["id"]);
          setIncomingMessages([data as Message])
          setIncomingLastIndex(0);
          setIncomingMessagesLength(data["payload"]["totalChunks"]);
          return;
        }
      }
      if (incomingLastIndex > -1) {
        if (data["qr"] == "p2pqr" && data["type"] == "send_chunk" && data["payload"]["id"]) {
          if (incomingLastIndex == incomingMessagesLength -1) {
            return;
          }
          if (data?.["payload"]?.["chunkIndex"] == incomingLastIndex) {
            setIncomingId(data["payload"]["id"]);
            setIncomingMessages([...incomingMessages, data])
            setIncomingLastIndex(data?.["payload"]?.["chunkIndex"] + 1);
          }
          return;
        }
        return;

      }

    } catch(e) {

    }
  }, [incomingLastIndex, incomingId, incomingMessagesLength, incomingMessages]);

  useEffect(() => {
    if (action == "receive") {
      if (incomingLastIndex > -1 && incomingMessagesLength == incomingLastIndex + 1) {
        setTimeout(async () => {
          const initMessage= incomingMessages[0] as any;
          const base64 = incomingMessages.slice(1).map((d: any) => d?.payload?.["data"] ?? "" as string).join("");
          const directory = `${FileSystem.documentDirectory}/p2pqr`;
          try {
            await FileSystem.makeDirectoryAsync(directory, {intermediates: true});
            const filePath = `${directory}.${initMessage.payload["name"] as string}`
            await FileSystem.writeAsStringAsync(filePath, base64, {encoding: FileSystem.EncodingType.Base64});
            await Sharing.shareAsync(filePath, {UTI: "public.item"})
          } catch(e) {

          }
          setAction("none");
        }, 1000);
      }
    }
  }, [action, incomingLastIndex, incomingMessages, incomingLastIndex, incomingMessagesLength])

  useEffect(() => {
    if (action == "send" || action == "receive") {
      (async () => {
        const { status } = await Brightness.requestPermissionsAsync();
        if (status === "granted") {
          Brightness.setSystemBrightnessAsync(1);
        }
      })();
    }
  }, [action]);

  const {width} = useWindowDimensions();

  const outgoingMessage = useMemo(() => {
    if (action != "send") {
      return ""
    }
    return JSON.stringify(outgoingMessages[outgoingIndex]);
  }, [action, outgoingIndex, outgoingMessages]);

  const incomingMessage = useMemo(() => {
    if (action != "receive") {
      return ""
    }
    if (incomingLastIndex > -1) {

      if (incomingMessagesLength == incomingLastIndex + 1) {
        return JSON.stringify({
          type: "receive_done",
          qr: "p2pqr",
          payload: {
            id: incomingId,
          }
        });
      }

        return JSON.stringify({
          type: "received_chunk",
          qr: "p2pqr",
          payload: {
            id: incomingId,
            chunkIndex: incomingLastIndex
          }
        });
    }
  }, [action, incomingId, incomingLastIndex, incomingMessagesLength]);

  if (action == "receive") {
    return (
      <View style={styles.background}>
        <View style={styles.main}>
          {hasCameraPermission === false ? (
            <Text>No access to camera</Text>
          ) : (
            <Camera
              style={StyleSheet.absoluteFillObject}
              type={CameraType.front}
              onBarCodeScanned={handleMessage}
              barCodeScannerSettings={{
                barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr],
              }}
            >
              <SafeAreaView>
                <View
                  style={{
                    width,
                    height: width,
                    marginTop: 72,
                  }}
                >
                  <QRCode value={incomingMessage} size={width} />
                </View>
                <View
                  style={{
                    width,
                    flexGrow: 1,
                  }}
                >
                  <View
                    style={{
                      width: "100%",
                      height: width,
                      justifyContent: "center",
                      alignItems: "center",
                      padding: 16
                    }}
                  >
                    <View style={styles.progressBar}>
                      {incomingLastIndex != -1 && (
                        <Text style={styles.darkText}>
                          {`${incomingLastIndex}/${incomingMessagesLength - 1} chunks received`}
                        </Text>
                      )}
                      {incomingLastIndex == -1 && (
                        <Text style={styles.darkText}>
                          {`waiting to receive`}
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      style={{ width: "100%" }}
                      onPress={() => setAction("none")}
                    >
                      <View style={{ height: 24 }} />
                      <View style={styles.receiveButton}>
                        <Text style={styles.text}>{"cancel"}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>
            </Camera>
          )}
        </View>
      </View>
    );
  }

  if (action == "send") {
    return (
      <View style={styles.background}>
        <View style={styles.main}>
          {hasCameraPermission === false ? (
            <Text>No access to camera</Text>
          ) : (
            <Camera
              style={StyleSheet.absoluteFillObject}
              type={CameraType.front}
              onBarCodeScanned={handleAck}
              barCodeScannerSettings={{
                barCodeTypes: [BarCodeScanner.Constants.BarCodeType.qr],
              }}
            >
              <SafeAreaView>
                <View
                  style={{
                    width,
                    height: width,
                    marginTop: 72,
                  }}
                >
                  <QRCode value={outgoingMessage} size={width} />
                </View>
                <View
                  style={{
                    width,
                    flexGrow: 1,
                  }}
                >
                  <View
                    style={{
                      width: "100%",
                      height: width,
                      justifyContent: "center",
                      alignItems: "center",
                      padding: 16
                    }}
                  >
                    <View style={styles.progressBar}>
                      <Text style={styles.darkText}>
                        {`${outgoingIndex}/${outgoingMessages.length - 1} chunks sent`}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={{ width: "100%" }}
                      onPress={() => setAction("none")}
                    >
                      <View style={{ height: 24 }} />
                      <View style={styles.receiveButton}>
                        <Text style={styles.text}>{"cancel"}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                </View>
              </SafeAreaView>
            </Camera>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ flex: 1 }}>
        {action == "none" && (
          <View style={styles.instructions}>
            <Text style={{ fontSize: 24, textAlign: "center" }}>
              {"pick a file to send"}
            </Text>
            <Text style={{ fontSize: 24, textAlign: "center" }}>{"or"}</Text>
            <Text style={{ fontSize: 24, textAlign: "center" }}>
              {"choose receive mode"}
            </Text>
          </View>
        )}
        {action == "selected_file" && document &&(
          <View style={styles.instructions}>
            <Text style={{ fontSize: 24, textAlign: "center" }}>
              {"file to send:"}
            </Text>
            <Text style={{ fontSize: 24, textAlign: "center" }}>
              {document.name}
            </Text>
          </View>

        )}
      </View>
      {action == "selected_file" && (
        <View style={styles.bottomContainer}>
          <TouchableOpacity style={{ width: "100%" }} onPress={onStartSendMode}>
            <View style={styles.sendButton}>
              <Text style={styles.text}>{"send file"}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={{ width: "100%" }} onPress={() => setAction("none")}>
            <View style={{ height: 24 }} />
            <View style={styles.receiveButton}>
              <Text style={styles.text}>{"cancel"}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
      {action == "none" && (
        <View style={styles.bottomContainer}>
          <TouchableOpacity onPress={pickDocument} style={{ width: "100%" }}>
            <View style={styles.sendButton}>
              <Text style={styles.text}>{"pick file to send"}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={{ width: "100%" }} onPress={onStartReceiving}>
            <View style={{ height: 24 }} />
            <View style={styles.receiveButton}>
              <Text style={styles.text}>{"receive file"}</Text>
            </View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  background: {
    height: "100%",
    width: "100%",
  },
  main: {
    height: "100%",
    width: "100%",
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
    width: "100%",
    padding: 16,
  },
  bottomContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  instructions: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBar: {
    height: 64,
    width: "100%",
    backgroundColor: "white",
    borderRadius: 8,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  sendButton: {
    height: 64,
    width: "100%",
    backgroundColor: "#0f8ede",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#61dafb",
    shadowColor: "#1d71a6",
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.9,
    shadowRadius: 2,
    elevation: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  receiveButton: {
    height: 64,
    width: "100%",
    backgroundColor: "#bb0fde",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#de0f90",
    shadowColor: "##6b0f48",
    shadowOffset: {
      width: 0,
      height: 0,
    },
    shadowOpacity: 0.9,
    shadowRadius: 2,
    elevation: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  text: {
    color: "white",
    fontSize: 24,
  },
  darkText: {
    color: "#222",
    fontSize: 24,
  },
});
