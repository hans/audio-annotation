import React, { useState, useRef, useEffect, useCallback, MutableRefObject } from 'react'
import * as Types from '../Types'
import Spectrogram from '../components/Spectrogram'
import RegionPlayer from '../components/RegionPlayer'
import AnnotationLayer, { updateAnnotation, shouldRejectAnnotationUpdate } from '../components/AnnotationLayer'
import _ from 'lodash'
import Audio, {
    percentInSegmentToTimeInSegment,
    playAudioPercent,
    playAudioInMovie,
    AudioState,
} from '../components/Audio'
import { apihost } from '../Misc'
import AudioPosition, { drawAudioPercent, clearAudioPosition } from '../components/AudioPosition'
import Waveform from '../components/Waveform'
import Timeline from '../components/Timeline'

export function setWorkerAnnotations(
    setAnnotations: (value: React.SetStateAction<{ [worker: string]: Types.Annotation[] }>) => any,
    worker: string
) {
    return (anns: Types.Annotation[]) => setAnnotations(prev => ({ ...prev, [worker]: anns }))
}

const spectrogramAnnotationStyle_: React.CSSProperties = {
    width: '100%',
    height: '85%',
    position: 'absolute',
    top: '0%',
    zIndex: 4,
}

const waveformAnnotationStyle_: React.CSSProperties = {
    width: '100%',
    height: '10%',
    position: 'absolute',
    top: '85%',
    zIndex: 4,
}

const spectrogramStyle_: React.CSSProperties = {
    width: '100%',
    height: '85%',
    position: 'absolute',
    top: '0%',
    zIndex: 0,
}

const regionStyle_: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: '0px',
    zIndex: 2,
}

const audioPositionStyle_: React.CSSProperties = {
    width: '100%',
    height: '100%',
    position: 'absolute',
    top: '0px',
    zIndex: 1,
}

const waveformStyle_: React.CSSProperties = {
    width: '100%',
    height: '10%',
    position: 'absolute',
    top: '85%',
    zIndex: 0,
    background: 'black',
}

const timelineStyle_: React.CSSProperties = {
    width: '100%',
    height: '5%',
    position: 'absolute',
    left: '0px',
    right: '0px',
    top: '95%',
    bottom: '0px',
    zIndex: 0,
    background: 'black',
}

export default React.memo(function SpectrogramWithAnnotations({
    movie,
    startTime,
    duration,
    topAnnotations = [],
    bottomAnnotations = [],
    setTopAnnotations = null,
    setBottomAnnotations = null,
    containerStyle = { position: 'relative' },
    spectrogramAnnotationStyle = spectrogramAnnotationStyle_,
    waveformAnnotationStyle = waveformAnnotationStyle_,
    spectrogramStyle = spectrogramStyle_,
    regionStyle = regionStyle_,
    audioPositionStyle = audioPositionStyle_,
    waveformStyle = waveformStyle_,
    timelineStyle = timelineStyle_,
    selectedTop = null,
    setSelectedTop = () => null,
    audioState,
    setAudioState,
    setClickPositions = () => null,
    clearClickMarker,
}: {
    movie: string
    startTime: Types.TimeInMovie
    duration: Types.TimeInMovie
    containerStyle?: React.CSSProperties
    spectrogramAnnotationStyle?: React.CSSProperties
    waveformAnnotationStyle?: React.CSSProperties
    spectrogramStyle?: React.CSSProperties
    regionStyle?: React.CSSProperties
    audioPositionStyle?: React.CSSProperties
    waveformStyle?: React.CSSProperties
    timelineStyle?: React.CSSProperties
    topAnnotations?: Types.Annotation[]
    bottomAnnotations?: Types.Annotation[]
    setTopAnnotations?: null | ((fn: (prev: Types.Annotation[]) => Types.Annotation[]) => void)
    setBottomAnnotations?: null | ((fn: (prev: Types.Annotation[]) => Types.Annotation[]) => void)
    selectedTop?: number | null
    setSelectedTop?: (arg: number | null, ann: null | Types.Annotation) => any
    audioState: AudioState
    setAudioState: (val: React.SetStateAction<AudioState>) => any
    setClickPositions?: (val: React.SetStateAction<Types.TimeInSegment[]>, clearn: boolean) => any
    clearClickMarker?: MutableRefObject<() => any>
}) {
    const [rawAudioBufferNormal, setRawAudioBufferNormal] = useState(null as null | ArrayBuffer)
    const [rawAudioBufferHalf, setRawAudioBufferHalf] = useState(null as null | ArrayBuffer)
    const [decodedBuffer, setDecodedBuffer] = useState<null | AudioBuffer>(null)
    const regionRef = useRef<HTMLCanvasElement>(null)
    const waveformRef = useRef<HTMLCanvasElement>(null)
    const positionRef = useRef<HTMLCanvasElement>(null)
    const regionDragRef = useRef<Types.DragFunctions>(null)
    const timelineRef = useRef<SVGSVGElement>(null)

    useEffect(() => {
        fetch(
            apihost +
            'api/static/audio-clips/' +
            Types.movieLocation(movie, startTime, Types.add(startTime, duration)) +
            '.mp3'
        )
            .then(function(response) {
                if (!response.ok) {
                    throw Error(response.statusText)
                }
                return response
            })
            .then(response => response.arrayBuffer())
            .then(result => {
                setRawAudioBufferNormal(result)
            })
            .catch(error => console.log(error))
    }, [movie, startTime, duration])

    useEffect(() => {
        fetch(
            apihost +
            'api/static/audio-clips/' +
            Types.movieLocation(movie, startTime, Types.add(startTime, duration)) +
            '-0.5.mp3'
        )
            .then(function(response) {
                if (!response.ok) {
                    throw Error(response.statusText)
                }
                return response
            })
            .then(response => response.arrayBuffer())
            .then(result => {
                setRawAudioBufferHalf(result)
            })
            .catch(error => console.log('Fail to get', error))
    }, [movie, startTime, duration])

    const onInteractFn = useCallback(
        (x?: number, p?: Types.TimeInSegment) => {
            if (!_.isUndefined(p)) {
                setClickPositions([p], false)
            }
            if (!_.isUndefined(x)) {
                regionDragRef.current!.onDragStart(x)
            }
        },
        [regionDragRef, setClickPositions]
    )
    const onBackgroundDragFn = useCallback(x => regionDragRef.current!.onDrag(x), [regionDragRef])
    const onBackgroundDragStartFn = useCallback(x => regionDragRef.current!.onDragStart(x), [regionDragRef])
    const onBackgroundDragEndFn = useCallback(x => regionDragRef.current!.onDragEnd(x), [regionDragRef])
    const onWordClickedFn = useCallback(
        (a, startTime) => playAudioInMovie(a.startTime!, a.endTime!, setAudioState, startTime),
        [setAudioState, startTime]
    )
    const updateAnnotationFn = useCallback(
        (...args) =>
            setTopAnnotations
                ? updateAnnotation(
                    setTopAnnotations,
                    decodedBuffer!,
                    shouldRejectAnnotationUpdate
                    // @ts-ignore
                )(...args)
                : () => null,
        [decodedBuffer, shouldRejectAnnotationUpdate]
    )

    const onRegionMouseDown = useCallback(() => {
        setAudioState(prev => ({
            playKey: prev.playKey + 1,
            playState: false,
            startTime: Types.to(0),
            endTime: null,
            playbackRate: 'normal',
        }))
        clearAudioPosition(positionRef)
    }, [positionRef])

    useEffect(() => {
        clearClickMarker!.current = () => {
            if (regionDragRef.current) regionDragRef.current.onClear()
        }
    }, [positionRef])

    const onRegionClick = useCallback(
        (position: Types.PercentInSegment, shiftKey: boolean) => {
            setClickPositions([percentInSegmentToTimeInSegment(position, decodedBuffer!)], false)
            playAudioPercent(position, shiftKey ? Types.addConst(position, 0.2) : null, setAudioState, decodedBuffer!)
        },
        [setAudioState, decodedBuffer, setClickPositions]
    )

    const onSelectRegion = useCallback(
        (start, end) => {
            setClickPositions(
                [percentInSegmentToTimeInSegment(start, decodedBuffer!), percentInSegmentToTimeInSegment(end, decodedBuffer!)],
                false
            )
            playAudioPercent(start, end, setAudioState, decodedBuffer!)
        },
        [setAudioState, decodedBuffer, setClickPositions]
    )

    // @ts-ignore
    return (
        <div className="spectrogram-with-annotations" style={containerStyle}>
            <AnnotationLayer
                editable={true}
                svgStyle={spectrogramAnnotationStyle}
                annotations={topAnnotations}
                startTime={startTime}
                duration={duration}
                buffer={decodedBuffer}
                color={'rgb(135, 208, 104)'}
                colorSelected={'rgb(250, 140, 22)'}
                selectable={true}
                updateAnnotation={updateAnnotationFn}
                onWordClicked={onWordClickedFn}
                onBackgroundDrag={onBackgroundDragFn}
                onBackgroundDragStart={onBackgroundDragStartFn}
                onBackgroundDragEnd={onBackgroundDragEndFn}
                onInteract={onInteractFn}
                selected={selectedTop}
                setSelected={setSelectedTop}
            />
            <AnnotationLayer
                editable={false}
                svgStyle={waveformAnnotationStyle}
                annotations={bottomAnnotations}
                startTime={startTime}
                duration={duration}
                buffer={decodedBuffer}
                color={'rgb(45, 183, 245)'}
                colorSelected={'rgba(255, 62, 203, 1)'}
                textHeight={'80%'}
                midlineHeight={'20%'}
                onWordClicked={onWordClickedFn}
                onBackgroundDrag={onBackgroundDragFn}
                onBackgroundDragStart={onBackgroundDragStartFn}
                onBackgroundDragEnd={onBackgroundDragEndFn}
                onInteract={onInteractFn}
            />
            <Waveform decodedBuffer={decodedBuffer} canvasStyle={waveformStyle} ref={waveformRef}></Waveform>
            <Timeline
                svgStyle={timelineStyle}
                ref={timelineRef}
                startTime={startTime}
                duration={duration}
                orientation={'bottom'}
                labelHeightPecent={'50%'}
            />
            <Spectrogram
                canvasStyle={spectrogramStyle}
                src={
                    apihost +
                    'api/static/spectrograms/' +
                    Types.movieLocation(movie, startTime, Types.add(startTime, duration)) +
                    '.jpg'
                }
            ></Spectrogram>
            {decodedBuffer ? (
                <RegionPlayer
                    ref={regionRef}
                    // @ts-ignore TODO
                    dragRef={regionDragRef}
                    decodedBuffer={decodedBuffer}
                    canvasStyle={regionStyle}
                    onMouseDown={onRegionMouseDown}
                    onClick={onRegionClick}
                    onSelectRegion={onSelectRegion}
                />
            ) : null}
            <AudioPosition ref={positionRef} canvasStyle={audioPositionStyle} />
            <Waveform decodedBuffer={decodedBuffer} canvasStyle={waveformStyle} ref={waveformRef}></Waveform>
            <Audio
                bufferNormal={rawAudioBufferNormal}
                bufferHalf={rawAudioBufferHalf}
                playKey={audioState.playKey}
                playState={audioState.playState}
                startTime={audioState.startTime}
                endTime={audioState.endTime}
                playbackRate={audioState.playbackRate}
                onStart={() => null}
                onEnd={() => clearAudioPosition(positionRef)}
                onAsyncPlaySample={(pos, posPercent) => {
                    drawAudioPercent(positionRef, posPercent)
                }}
                callbackEveryNSeconds={0.01}
                onDecode={buffer => {
                    setDecodedBuffer(buffer)
                }}
                onDecodeError={ty => console.log('DecodeError', ty)}
            />
        </div>
    )
})
