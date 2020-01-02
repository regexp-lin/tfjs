/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View, Image, Text, TouchableHighlight } from 'react-native';
import * as Permissions from 'expo-permissions';
import { Camera } from 'expo-camera';
import {StyleTranfer} from './style_transfer';
import {base64ImageToTensor, tensorToImageUrl, resizeImage, toDataUri} from './image_utils';
import * as tf from '@tensorflow/tfjs';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import {fromTexture, toTexture, renderToGLView, decodeJpeg, fetch} from '@tensorflow/tfjs-react-native';
import { Dimensions,PixelRatio, LayoutChangeEvent } from 'react-native';



interface ScreenProps {
  returnToMain: () => void;
}

interface ScreenState {
  mode: 'results' | 'newStyleImage' | 'newContentImage';
  resultImage?: string;
  styleImage?: string;
  contentImage?: string;
  hasCameraPermission?: boolean;
  // tslint:disable-next-line: no-any
  cameraType: any;
  isLoading: boolean;
}

let cameraPreviewWidth: number;
let cameraPreviewHeight: number;

export class WebcamDemo extends React.Component<ScreenProps,ScreenState> {
  private camera?: Camera|null;
  private styler: StyleTranfer;
  private glView?: GLView;
  private texture?: WebGLTexture;
  private _rafID?: number;

  constructor(props: ScreenProps) {
    super(props);
    this.state = {
      mode: 'results',
      cameraType: Camera.Constants.Type.back,
      isLoading: true,
    };
    this.styler = new StyleTranfer();
  }

  async componentDidMount() {
    // await this.styler.init();
    const { status } = await Permissions.askAsync(Permissions.CAMERA);
    // this.camTexture = await GLView.createCameraTextureAsync();

    this.setState({
      hasCameraPermission: status === 'granted',
      isLoading: false
    });
  }

  showResults() {
    this.setState({ mode: 'results' });
  }

  takeStyleImage() {
    this.setState({ mode: 'newStyleImage' });
  }

  takeContentImage() {
    this.setState({ mode: 'newContentImage' });
  }

  flipCamera() {
    const newState = this.state.cameraType === Camera.Constants.Type.back
          ? Camera.Constants.Type.front
          : Camera.Constants.Type.back;
    this.setState({
      cameraType: newState,
    });
  }

  renderStyleImagePreview() {
    const {styleImage} = this.state;
    if(styleImage == null) {
      return (
        <View>
          <Text style={styles.instructionText}>Style</Text>
          <Text style={{fontSize: 48, paddingLeft: 0}}>💅🏽</Text>
        </View>
      );
    } else {
      return (
        <View>
          <Image
            style={styles.imagePreview}
            source={{uri: toDataUri(styleImage)}} />
            <Text style={styles.centeredText}>Style</Text>
        </View>
      );
    }
  }

  renderContentImagePreview() {
    const {contentImage} = this.state;
    if(contentImage == null) {
      return (
        <View>
          <Text style={styles.instructionText}>Stuff</Text>
          <Text style={{fontSize: 48, paddingLeft: 0}}>🖼️</Text>
        </View>
      );
    } else {
      return (
        <View>
          <Image
            style={styles.imagePreview}
            source={{uri: toDataUri(contentImage)}} />
            <Text style={styles.centeredText}>Stuff</Text>
        </View>
      );
    }
  }

  async stylize(contentImage: string, styleImage: string):
    Promise<string> {
    const contentTensor = await base64ImageToTensor(contentImage);
    const styleTensor = await base64ImageToTensor(styleImage);
    const stylizedResult = this.styler.stylize(
      styleTensor, contentTensor);
    const stylizedImage = await tensorToImageUrl(stylizedResult);
    tf.dispose([contentTensor, styleTensor, stylizedResult]);
    return stylizedImage;
  }

  async handleCameraCapture() {
    const {mode} = this.state;
    let {styleImage, contentImage, resultImage} = this.state;
    this.setState({
      isLoading: true,
    });
    let image = await this.camera!.takePictureAsync({
      skipProcessing: true,
    });
    image = await resizeImage(image.uri, 240);

    if(mode === 'newStyleImage' && image.base64 != null) {
      styleImage = image.base64;
      if(contentImage == null) {
        this.setState({
          styleImage,
          mode: 'results',
          isLoading: false,
        });
      } else {
        resultImage = await this.stylize(contentImage, styleImage),
        this.setState({
          styleImage,
          contentImage,
          resultImage,
          mode: 'results',
          isLoading: false,
        });
      }
    } else if (mode === 'newContentImage' && image.base64 != null) {
      contentImage = image.base64;
      if(styleImage == null) {
        this.setState({
          contentImage,
          mode: 'results',
          isLoading: false,
        });
      } else {
        resultImage = await this.stylize(contentImage, styleImage);
        this.setState({
          contentImage,
          styleImage,
          resultImage,
          mode: 'results',
          isLoading: false,
        });
      }
    }
  }

  async createCameraTexture(): Promise<WebGLTexture> {
    const { status } = await Permissions.askAsync(Permissions.CAMERA);
    if (status !== 'granted') {
      throw new Error('Denied camera permissions!');
    }
    //@ts-ignore
    return this.glView!.createCameraTextureAsync(this.camera!);
  }

  onCameraLayout(event: LayoutChangeEvent) {
    const {x, y, width, height} = event.nativeEvent.layout;
    cameraPreviewHeight = height;
    cameraPreviewWidth = width;
    console.log('onCameraLayout', x, y, width, height);
  }

  onGLViewLayout(event: LayoutChangeEvent) {
    const {x, y, width, height} = event.nativeEvent.layout;
    console.log('onGLViewLayout', x, y, width, height);
  }

  async roundtrip(gl: WebGL2RenderingContext) {
    const width = 2;
    const height = 2;
    const depth = 4;

    const inTensor =
      tf.truncatedNormal([width, height, depth], 127, 40, 'int32');
    const texture = await toTexture(gl, inTensor as tf.Tensor3D);

    const outTensor = fromTexture(gl, texture,
      {width, height, depth},
      {width, height, depth});

    const inData = inTensor.dataSync();
    const outData = outTensor.dataSync();
    const matches = tf.util.arraysEqual(inData, outData);

    if(matches) {
      console.log('**toTexture -> fromTexture roundtrip success');
    } else {
      console.log('ERROR toTexture -> fromTexture roundtrip failed');
      console.log('input', inTensor.shape, Array.from(inData));
      console.log('output', outTensor.shape, Array.from(outData));
    }

    tf.dispose([inTensor, outTensor]);
    return matches;
  }

  async resizeNNSameAspect(gl: WebGL2RenderingContext, alignCorners: boolean) {
    // Same aspect ratio
    const inShape: [number, number, number] = [4,4,4];
    const input = tf.tensor3d([
      [
        [200, 201, 202, 255], // a
        [190, 191, 192, 255], // b
        [180, 181, 182, 255], // c
        [170, 171, 172, 255], // d
      ],
      [
        [160, 161, 162, 255], // e
        [150, 151, 152, 255], // f
        [140, 141, 142, 255], // g
        [130, 131, 132, 255], // h
      ],
      [
        [120, 121, 122, 255], // i
        [110, 111, 112, 255], // j
        [100, 101, 102, 255], // k
        [90, 91, 92, 255],    // l
      ],
      [
        [80, 81, 82, 255],    // m
        [70, 71, 72, 255],    // n
        [60, 61, 62, 255],    // o
        [50, 51, 52, 255],    // p
      ]
    ], inShape, 'int32');

    let expected: tf.Tensor3D;
    if (alignCorners) {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [170, 171, 172, 255]
        ],
        [
          [ 80,  81,  82, 255],
          [ 50,  51,  52, 255]
        ]
      ], [2,2,4], 'int32');
    } else {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],  // x
          [180, 181, 182, 255],  // y
        ],
        [
          [120, 121, 122, 255],  // z
          [100, 101, 102, 255],  // w
        ]
      ], [2,2,4], 'int32');
    }

    const size: [number, number] = [2, 2];
    const texture = await toTexture(gl, input);
    const outTensor = fromTexture(
      gl,
      texture,
      {width: inShape[0], height: inShape[1], depth: inShape[2]},
      {width: size[0], height: size[1], depth: 4},
      {alignCorners, interpolation: 'nearest_neighbor'});

    const fromTexResizeMatch = tf.util.arraysEqual(
      expected.dataSync(),
      outTensor.dataSync()) &&
      tf.util.arraysEqual(expected.shape, outTensor.shape);

    if(fromTexResizeMatch) {
      console.log(
        `**fromTexture resizeNNSameAspect success alignCorners=${alignCorners}`);
    } else {
      console.log(
        `ERROR fromTexture resizeNNSameAspect alignCorners=${alignCorners}`);
      console.log('input', input.shape);
      input.print();
      console.log('expected', expected.shape);
      expected.print();
      console.log('outTensor', outTensor.shape);
      outTensor.print();
    }

    tf.dispose([input, expected, outTensor]);
    return fromTexResizeMatch;
  }

  async resizeBilinearSameAspect(gl: WebGL2RenderingContext,
    alignCorners: boolean) {
    // Same aspect ratio
    const inShape: [number, number, number] = [4,4,4];
    const input = tf.tensor3d([
      [
        [200, 201, 202, 255], // a
        [190, 191, 192, 255], // b
        [180, 181, 182, 255], // c
        [170, 171, 172, 255], // d
      ],
      [
        [160, 161, 162, 255], // e
        [150, 151, 152, 255], // f
        [140, 141, 142, 255], // g
        [130, 131, 132, 255], // h
      ],
      [
        [120, 121, 122, 255], // i
        [110, 111, 112, 255], // j
        [100, 101, 102, 255], // k
        [90, 91, 92, 255],    // l
      ],
      [
        [80, 81, 82, 255],    // m
        [70, 71, 72, 255],    // n
        [60, 61, 62, 255],    // o
        [50, 51, 52, 255],    // p
      ]
    ], inShape, 'int32');

    let expected: tf.Tensor3D;
    if (alignCorners) {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [170, 171, 172, 255],
        ],
        [
          [ 80,  81,  82, 255],
          [ 50,  51,  52, 255],
        ]
      ], [2,2,4], 'int32');
    } else {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],  // x
          [180, 181, 182, 255],  // y
        ],
        [
          [120, 121, 122, 255],  // z
          [100, 101, 102, 255],  // w
        ]
      ], [2,2,4], 'int32');
    }

    const size: [number, number] = [2, 2];
    const texture = await toTexture(gl, input);
    const outTensor = fromTexture(
      gl,
      texture,
      {width: inShape[0], height: inShape[1], depth: inShape[2]},
      {width: size[0], height: size[1], depth: 4},
      {alignCorners, interpolation: 'bilinear'});

    const fromTexResizeMatch = tf.util.arraysEqual(
      expected.dataSync(),
      outTensor.dataSync()) &&
      tf.util.arraysEqual(expected.shape, outTensor.shape);

    if(fromTexResizeMatch) {
      console.log(
        `**fromTexture resizeBilinearSameAspect success alignCorners=${alignCorners}`);
    } else {
      console.log(
        `ERROR fromTexture resizeBilinearSameAspect alignCorners=${alignCorners}`);
      console.log('input', input.shape);
      input.print();
      console.log('expected', expected.shape);
      expected.print();
      console.log('outTensor', outTensor.shape);
      outTensor.print();
    }

    tf.dispose([input, expected, outTensor]);
    return fromTexResizeMatch;
  }

  async resizeNNWide(gl: WebGL2RenderingContext, alignCorners: boolean) {
    const inHeight = 4;
    const inWidth = 4;
    const inDepth = 4;

    const outHeight = 2;
    const outWidth = 3;
    const outDepth = 4;

    const input = tf.tensor3d([
      [
        [200, 201, 202, 255], // a
        [190, 191, 192, 255], // b
        [180, 181, 182, 255], // c
        [170, 171, 172, 255], // d
      ],
      [
        [160, 161, 162, 255], // e
        [150, 151, 152, 255], // f
        [140, 141, 142, 255], // g
        [130, 131, 132, 255], // h
      ],
      [
        [120, 121, 122, 255], // i
        [110, 111, 112, 255], // j
        [100, 101, 102, 255], // k
        [90, 91, 92, 255],    // l
      ],
      [
        [80, 81, 82, 255],    // m
        [70, 71, 72, 255],    // n
        [60, 61, 62, 255],    // o
        [50, 51, 52, 255],    // p
      ]
    ], [inHeight, inWidth, inDepth], 'int32');

    let expected: tf.Tensor3D;
    if (alignCorners) {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [180, 181, 182, 255],
          [170, 171, 172, 255]],

        [
          [ 80,  81,  82, 255],
          [ 60,  61,  62, 255],
          [ 50,  51,  52, 255],
        ]
      ], [outHeight, outWidth, outDepth], 'int32');
    } else {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [190, 191, 192, 255],
          [180, 181, 182, 255],
        ],
        [
          [120, 121, 122, 255],
          [110, 111, 112, 255],
          [100, 101, 102, 255],
        ]
      ], [outHeight, outWidth, outDepth], 'int32');
    }

    const texture = await toTexture(gl, input);
    const outTensor = fromTexture(
      gl,
      texture,
      {width: inWidth, height: inHeight, depth: inDepth},
      {width: outWidth, height: outHeight, depth: outDepth},
      {alignCorners, interpolation: 'nearest_neighbor'});

    const fromTexResizeMatch = tf.util.arraysEqual(
      expected.dataSync(),
      outTensor.dataSync()) &&
      tf.util.arraysEqual(expected.shape, outTensor.shape);

    if(fromTexResizeMatch) {
      console.log(
        `**fromTexture resizeNNNarrow success alignCorners=${alignCorners}`);
    } else {
      console.log(
        `ERROR fromTexture resizeNNNarrow. alignCorners=${alignCorners}`);
      console.log('input', input.shape);
      input.print();
      console.log('expected', expected.shape);
      expected.print();
      console.log('outTensor', outTensor.shape);
      outTensor.print();
    }

    tf.dispose([input, expected, outTensor]);
    return fromTexResizeMatch;
  }

  async resizeBilinearWide(gl: WebGL2RenderingContext,
    alignCorners: boolean) {
    const inHeight = 4;
    const inWidth = 4;
    const inDepth = 4;

    const outHeight = 2;
    const outWidth = 3;
    const outDepth = 4;

    const input = tf.tensor3d([
      [
        [200, 201, 202, 255], // a
        [190, 191, 192, 255], // b
        [180, 181, 182, 255], // c
        [170, 171, 172, 255], // d
      ],
      [
        [160, 161, 162, 255], // e
        [150, 151, 152, 255], // f
        [140, 141, 142, 255], // g
        [130, 131, 132, 255], // h
      ],
      [
        [120, 121, 122, 255], // i
        [110, 111, 112, 255], // j
        [100, 101, 102, 255], // k
        [90, 91, 92, 255],    // l
      ],
      [
        [80, 81, 82, 255],    // m
        [70, 71, 72, 255],    // n
        [60, 61, 62, 255],    // o
        [50, 51, 52, 255],    // p
      ]
    ], [inHeight, inWidth, inDepth], 'int32');

    let expected: tf.Tensor3D;
    if (alignCorners) {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [185, 186, 187, 255],
          [170, 171, 172, 255],],
        [
          [80 , 81 , 82 , 255],
          [65 , 66 , 67 , 255],
          [50 , 51 , 52 , 255],
        ]
      ], [outHeight, outWidth, outDepth], 'int32');
    } else {
      expected = tf.tensor3d([
        [
          [200, 201, 202, 255],
          [187, 188, 189, 255],
          [173, 174, 175, 255],],
        [
          [120, 121, 122, 255],
          [107, 108, 109, 255],
          [93 , 94 , 95 , 255],
        ]
      ], [outHeight, outWidth, outDepth], 'int32');
    }

    const texture = await toTexture(gl, input);
    const outTensor = fromTexture(
      gl,
      texture,
      {width: inWidth, height: inHeight, depth: inDepth},
      {width: outWidth, height: outHeight, depth: outDepth},
      {alignCorners, interpolation: 'bilinear'});

    const fromTexResizeMatch = tf.util.arraysEqual(
      expected.dataSync(),
      outTensor.dataSync()) &&
      tf.util.arraysEqual(expected.shape, outTensor.shape);

    if(fromTexResizeMatch) {
      console.log(
        `**fromTexture resizeBilinearWide success alignCorners=${alignCorners}`);
    } else {
      console.log(
        `ERROR fromTexture resizeBilinearWide. alignCorners=${alignCorners}`);
      console.log('input', input.shape);
      input.print();
      console.log('expected', expected.shape);
      expected.print();
      console.log('outTensor', outTensor.shape);
      outTensor.print();
    }

    tf.dispose([input, expected, outTensor]);
    return fromTexResizeMatch;
  }

 async onContextCreate(gl: ExpoWebGLRenderingContext) {
    console.log('onContextCreate texture tests');
    await this.roundtrip(gl);
    await this.resizeNNSameAspect(gl, false);
    await this.resizeNNSameAspect(gl, true);
    await this.resizeNNWide(gl, false);
    await this.resizeNNSameAspect(gl, true);

    await this.resizeBilinearSameAspect(gl, false);
    await this.resizeBilinearSameAspect(gl, true);
    await this.resizeBilinearWide(gl, false);
    await this.resizeBilinearWide(gl, true);
    console.log('------ END onContextCreate texture tests --------');


    const ratios = await this.camera!.getSupportedRatiosAsync();
    console.log('Supported aspect ratios', ratios);
    const picSizes = await this.camera!.getAvailablePictureSizesAsync('4:3');
    console.log('Available picSizes 4:3', picSizes);
    const picSizes2 = await this.camera!.getAvailablePictureSizesAsync('16:9');
    console.log('Available picSizes 16:9', picSizes2);

    this.texture = await this.createCameraTexture();
    const cameraTexture = this.texture;
    const pixelRatio = PixelRatio.get();

    let width = Math.floor(cameraPreviewWidth * pixelRatio);
    let height = Math.floor(cameraPreviewHeight * pixelRatio);
    const depth = 4;

    // 4032x3024
    // width = Math.floor(3024);
    // height = Math.floor(4032);

    console.log('onContextCreate.pixelRatio', pixelRatio);
    console.log('onContextCreate.w:h:d', width, height, depth);
    console.log('onContextCreate.gl dims',
      gl.drawingBufferWidth, gl.drawingBufferHeight);
    console.log('onContextCreate.gl viewport', gl.getParameter(gl.VIEWPORT));

    const targetWidth = width / 4;
    const targetHeight = height/ 4;
    const targetDepth = depth;

    const image = require('../../assets/images/catsmall.jpg');
    const imageAssetPath = Image.resolveAssetSource(image);
    const response = await fetch(imageAssetPath.uri, {}, { isBinary: true });
    const rawImageData = await response.arrayBuffer();

    const imageTensor = decodeJpeg(new Uint8Array(rawImageData), 3);
    const imageTensor4d = imageTensor.pad([[0,0],[0,0],[0,1]], 255);
    console.log('imagetensorshape', imageTensor.shape);
    console.log('imagetensordata', Array.from(imageTensor.dataSync().slice(0, 10)));
    console.log('imageTensor4d shape', imageTensor4d.shape);
    console.log('imageTensor4d', Array.from(imageTensor4d.dataSync().slice(0, 10)));

    // Render loop
    let start;
    let end;
    const loop = async () => {
      // this._rafID = requestAnimationFrame(loop);

      start = Date.now();
      const resizedCamTensor = fromTexture(
        gl,
        cameraTexture,
        // Source
        {width, height, depth},
        // Target
        {width: targetWidth, height: targetHeight, depth: targetDepth},
        {alignCorners: false},
      );
      // console.log('from rexture res', resizedCamTensor.shape);
      // console.log('from rexture res data', Array.from(resizedCamTensor.dataSync().slice(0, 100)));
      end = Date.now();
      // console.log('fromTexture:time', end - start);

      start = Date.now();
      const resizedCamTexture = await toTexture(gl, resizedCamTensor);
      end = Date.now();
      // console.log('toTexture:time', end - start);



      resizedCamTensor.dispose();

      // renderToGLView(gl, resizedCamTexture, { width, height });


      const catTexture = await toTexture(gl, imageTensor4d);
      const catT = fromTexture(gl, catTexture,
        {height: imageTensor4d.shape[0], width: imageTensor4d.shape[1], depth: imageTensor4d.shape[2]},
        {height: imageTensor4d.shape[0]/2, width: imageTensor4d.shape[1]/2, depth: imageTensor4d.shape[2]}
      );
      const smallCat = await toTexture(gl, catT);
      renderToGLView(gl, smallCat, { width, height });

      gl.endFrameEXP();
    };

    setInterval(() => {
      loop();
    }, 800);

  }

  renderCameraCapture() {
    const {hasCameraPermission} = this.state;

    if (hasCameraPermission === null) {
      return <View />;
    } else if (hasCameraPermission === false) {
      return <Text>No access to camera</Text>;
    }
    return (
      <View  style={styles.cameraContainer}>
        <Camera
          style={styles.camera}
          type={this.state.cameraType}
          pictureSize='320x240'
          ref={ref => { this.camera = ref; }}>
        </Camera>
        <View style={styles.cameraControls}>
            <TouchableHighlight
              style={styles.flipCameraBtn}
              onPress={() => {this.flipCamera();}}
              underlayColor='#FFDE03'>
              <Text style={{fontSize: 16, color: 'white'}}>
                FLIP
              </Text>
            </TouchableHighlight>
            <TouchableHighlight
              style={styles.takeImageBtn}
              onPress={() => { this.handleCameraCapture(); }}
              underlayColor='#FFDE03'>
              <Text style={{fontSize: 16, color: 'white', fontWeight: 'bold'}}>
                TAKE
              </Text>
            </TouchableHighlight>
            <TouchableHighlight
              style={styles.cancelBtn}
              onPress={() => {this.showResults(); }}
              underlayColor='#FFDE03'>
              <Text style={{fontSize: 16, color: 'white'}}>
                BACK
              </Text>
            </TouchableHighlight>
          </View>
        </View>
    );
  }

  renderResults() {
    const {resultImage} = this.state;
    return (
      <View>
        <View style={styles.resultImageContainer}>
          {resultImage == null ?
            <Text style={styles.introText}>
              Tap the squares below to add style and content
              images and see the magic!
            </Text>
            :
            <Image
              style={styles.resultImage}
              resizeMode='contain'
              source={{uri: toDataUri(resultImage)}} />
          }
          <TouchableHighlight
            style={styles.styleImageContainer}
            onPress={() => this.takeStyleImage()}
            underlayColor='white'>
              {this.renderStyleImagePreview()}
          </TouchableHighlight>

          <TouchableHighlight
            style={styles.contentImageContainer}
            onPress={() => this.takeContentImage()}
            underlayColor='white'>
            {this.renderContentImagePreview()}
          </TouchableHighlight>

        </View>
      </View>
    );
  }

  render() {
    const {isLoading} = this.state;
    const camV = <View style={styles.cameraContainer}>
        <Camera
          style={styles.camera}
          type={this.state.cameraType}
          zoom={0}
          ref={ref => this.camera = ref!}
          onLayout={this.onCameraLayout.bind(this)}
        />
        <GLView
          style={styles.camera}
          onLayout={this.onGLViewLayout.bind(this)}
          onContextCreate={this.onContextCreate.bind(this)}
          ref={ref => this.glView = ref!}
        />
        </View>;
    return (
      <View style={{width:'100%'}}>
        {isLoading ? <View style={[styles.loadingIndicator]}>
          <ActivityIndicator size='large' color='#FF0266' />
        </View> : camV}
        {/* {mode === 'results' ?
              this.renderResults() : this.renderCameraCapture()} */}
      </View>
    );
  }
}

const styles = StyleSheet.create({
   container: {
    flex: 1,
    flexDirection: 'column',
  },
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24
  },
  centeredText: {
    textAlign: 'center',
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: 'black',
    marginBottom: 6
  },
  loadingIndicator: {
    position: 'absolute',
    top: 20,
    right: 20,
    // flexDirection: 'row',
    // justifyContent: 'flex-end',
    zIndex: 200,
    // width: '100%'
  },
  cameraContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: '#fff',
  },
  camera : {
    display: 'flex',
    width: '60%',
    height: '40%',
    // backgroundColor: '#f0F',
    zIndex: 1,
    borderWidth: 2,
    borderRadius: 2,
    borderColor: '#f0f',
  },
  cameraControls: {
    display: 'flex',
    flexDirection: 'row',
    width: '92%',
    justifyContent: 'space-between',
    marginTop: 40,
    zIndex: 100,
    backgroundColor: 'transparent',
  },
  flipCameraBtn: {
    backgroundColor: '#424242',
    width: 75,
    height: 75,
    borderRadius:16,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  takeImageBtn: {
    backgroundColor: '#FF0266',
    width: 75,
    height: 75,
    borderRadius:50,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#424242',
    width: 75,
    height: 75,
    borderRadius:4,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultImageContainer : {
    width: '100%',
    height: '100%',
    padding:5,
    margin:0,
    backgroundColor: '#fff',
    zIndex: 1,
  },
  resultImage: {
    width: '98%',
    height: '98%',
  },
  styleImageContainer: {
    position:'absolute',
    width: 80,
    height: 150,
    bottom: 30,
    left: 20,
    zIndex: 10,
    borderRadius:10,
    backgroundColor: 'rgba(176, 222, 255, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(176, 222, 255, 0.7)',
  },
  contentImageContainer: {
    position:'absolute',
    width: 80,
    height: 150,
    bottom:30,
    right: 20,
    zIndex: 10,
    borderRadius:10,
    backgroundColor: 'rgba(255, 197, 161, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255, 197, 161, 0.7)',
  },
  imagePreview: {
    width: 78,
    height: 148,
    borderRadius:10,
  },
  instructionText: {
    fontSize: 28,
    fontWeight:'bold',
    paddingLeft: 5
  },
  introText: {
    fontSize: 52,
    fontWeight:'bold',
    padding: 20,
    textAlign: 'left',
  }

});
